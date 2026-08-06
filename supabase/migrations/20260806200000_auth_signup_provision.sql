-- Signup / username login support for PWA (does not touch local Docker kids app).

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists phone text,
  add column if not exists email text;

-- ── Provision household for a newly confirmed Auth user (from signup metadata) ──
create or replace function public.ensure_my_household()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  meta jsonb;
  v_email text;
  v_username text;
  v_display text;
  v_phone text;
  v_house text;
  hid uuid;
  now_iso text := to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  init_state jsonb;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into me from public.profiles where id = uid;
  if me.id is not null then
    return me;
  end if;

  select raw_user_meta_data, email into meta, v_email
  from auth.users where id = uid;

  v_username := lower(trim(coalesce(meta->>'username', split_part(coalesce(v_email, 'user'), '@', 1))));
  v_username := regexp_replace(v_username, '[^a-z0-9._-]', '', 'g');
  if v_username = '' then
    v_username := 'admin';
  end if;
  v_display := nullif(trim(coalesce(meta->>'display_name', meta->>'name', v_username)), '');
  v_phone := nullif(trim(coalesce(meta->>'phone', '')), '');
  v_house := nullif(trim(coalesce(meta->>'household_name', '')), '');
  if v_house is null or v_house = '' then
    v_house := 'My House';
  end if;

  insert into public.households (name) values (v_house) returning id into hid;

  insert into public.household_settings (household_id, daily_target, penalty_pts)
  values (hid, 15, 5);

  insert into public.profiles (id, household_id, username, roles, display_name, phone, email)
  values (
    uid,
    hid,
    v_username,
    array['admin', 'chore']::public.app_role[],
    coalesce(v_display, v_username),
    v_phone,
    v_email
  )
  returning * into me;

  insert into public.user_progress (user_id, household_id, points, checked)
  values (uid, hid, 0, '{}'::jsonb)
  on conflict (user_id) do nothing;

  init_state := jsonb_build_object(
    'rev', 1,
    'userScoped', true,
    'dailyTarget', 15,
    'penaltyPts', 5,
    'pinHash', null,
    'users', jsonb_build_array(
      jsonb_build_object(
        'id', uid,
        'username', v_username,
        'passwordHash', '',
        'roles', jsonb_build_array('admin', 'chore'),
        'displayName', coalesce(v_display, v_username),
        'phone', v_phone,
        'email', v_email,
        'createdAt', now_iso,
        'soundPref', 'on'
      )
    ),
    'chores', '[]'::jsonb,
    'rewards', '[]'::jsonb,
    'oneTimeTasks', '[]'::jsonb,
    'history', '[]'::jsonb,
    'adminLog', '[]'::jsonb,
    'userProgress', jsonb_build_object(
      uid::text, jsonb_build_object(
        'points', 0,
        'checked', '{}'::jsonb,
        'history', '[]'::jsonb,
        'lastResetDate', null
      )
    ),
    'tasks', '[]'::jsonb,
    'calendars', '[]'::jsonb
  );

  insert into public.household_app_state (household_id, state, rev, updated_at)
  values (hid, init_state, 1, now())
  on conflict (household_id) do nothing;

  return me;
end;
$$;

-- Auto-provision inside get_app_state when profile is missing
create or replace function public.get_app_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  doc public.household_app_state;
begin
  me := public.ensure_my_household();

  select * into doc from public.household_app_state where household_id = me.household_id;
  if doc.household_id is null then
    return jsonb_build_object(
      'rev', 0,
      'state', null,
      'me', jsonb_build_object(
        'id', me.id,
        'username', me.username,
        'roles', me.roles,
        'display_name', me.display_name,
        'phone', me.phone,
        'email', me.email
      )
    );
  end if;

  return jsonb_build_object(
    'rev', doc.rev,
    'state', doc.state,
    'me', jsonb_build_object(
      'id', me.id,
      'username', me.username,
      'roles', me.roles,
      'display_name', me.display_name,
      'phone', me.phone,
      'email', me.email
    )
  );
end;
$$;

-- Households matching an email or username (for sign-in dropdown). Safe for anon.
create or replace function public.lookup_households_for_login(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ident text := lower(trim(coalesce(p_identifier, '')));
  result jsonb := '[]'::jsonb;
begin
  if ident = '' then
    return result;
  end if;

  if position('@' in ident) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'household_id', h.id,
      'household_name', h.name,
      'username', p.username
    ) order by h.name), '[]'::jsonb)
    into result
    from public.profiles p
    join public.households h on h.id = p.household_id
    where lower(coalesce(p.email, '')) = ident
       or exists (
         select 1 from auth.users u
         where u.id = p.id and lower(u.email) = ident
       );
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'household_id', h.id,
      'household_name', h.name,
      'username', p.username
    ) order by h.name), '[]'::jsonb)
    into result
    from public.profiles p
    join public.households h on h.id = p.household_id
    where lower(p.username) = ident;
  end if;

  return result;
end;
$$;

-- Resolve Auth email for username (or email) within a household. Safe for anon.
create or replace function public.resolve_login(p_household_id uuid, p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ident text := lower(trim(coalesce(p_identifier, '')));
  p public.profiles;
  auth_email text;
begin
  if p_household_id is null or ident = '' then
    raise exception 'household and identifier required';
  end if;

  if position('@' in ident) > 0 then
    select * into p from public.profiles
    where household_id = p_household_id
      and (
        lower(coalesce(email, '')) = ident
        or id in (select id from auth.users where lower(email) = ident)
      )
    limit 1;
  else
    select * into p from public.profiles
    where household_id = p_household_id and lower(username) = ident
    limit 1;
  end if;

  if p.id is null then
    raise exception 'user_not_found';
  end if;

  select email into auth_email from auth.users where id = p.id;
  if auth_email is null or auth_email = '' then
    raise exception 'user_not_found';
  end if;

  return jsonb_build_object(
    'email', auth_email,
    'username', p.username,
    'household_id', p.household_id
  );
end;
$$;

-- Attach a member profile + app_state user (called by create_member edge function as the new user or via service role path).
-- Admins call create_household_member after Auth user is created.
create or replace function public.create_household_member(
  p_user_id uuid,
  p_username text,
  p_display_name text,
  p_phone text,
  p_email text,
  p_roles public.app_role[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  admin public.profiles;
  v_username text := lower(trim(coalesce(p_username, '')));
  v_roles public.app_role[] := coalesce(p_roles, array['chore']::public.app_role[]);
  now_iso text := to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  doc public.household_app_state;
  new_user jsonb;
  users jsonb;
begin
  select * into admin from public.profiles where id = auth.uid();
  if admin.id is null or not ('admin' = any(admin.roles)) then
    raise exception 'admin required';
  end if;
  if p_user_id is null or v_username = '' then
    raise exception 'user_id and username required';
  end if;
  if exists (
    select 1 from public.profiles
    where household_id = admin.household_id and lower(username) = v_username
  ) then
    raise exception 'username_taken';
  end if;

  insert into public.profiles (id, household_id, username, roles, display_name, phone, email)
  values (
    p_user_id,
    admin.household_id,
    v_username,
    v_roles,
    coalesce(nullif(trim(p_display_name), ''), v_username),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_email, '')), '')
  );

  insert into public.user_progress (user_id, household_id, points, checked)
  values (p_user_id, admin.household_id, 0, '{}'::jsonb)
  on conflict (user_id) do nothing;

  new_user := jsonb_build_object(
    'id', p_user_id,
    'username', v_username,
    'passwordHash', '',
    'roles', to_jsonb(v_roles),
    'displayName', coalesce(nullif(trim(p_display_name), ''), v_username),
    'phone', nullif(trim(coalesce(p_phone, '')), ''),
    'email', nullif(trim(coalesce(p_email, '')), ''),
    'createdAt', now_iso,
    'soundPref', 'on'
  );

  select * into doc from public.household_app_state where household_id = admin.household_id for update;
  if doc.household_id is null then
    insert into public.household_app_state (household_id, state, rev, updated_at)
    values (
      admin.household_id,
      jsonb_build_object(
        'rev', 1,
        'userScoped', true,
        'users', jsonb_build_array(new_user),
        'userProgress', jsonb_build_object(
          p_user_id::text, jsonb_build_object('points', 0, 'checked', '{}'::jsonb, 'history', '[]'::jsonb)
        )
      ),
      1,
      now()
    );
  else
    users := coalesce(doc.state->'users', '[]'::jsonb) || jsonb_build_array(new_user);
    update public.household_app_state
      set state = doc.state
        || jsonb_build_object(
          'users', users,
          'userProgress', coalesce(doc.state->'userProgress', '{}'::jsonb) || jsonb_build_object(
            p_user_id::text, jsonb_build_object('points', 0, 'checked', '{}'::jsonb, 'history', '[]'::jsonb)
          ),
          'rev', doc.rev + 1
        ),
          rev = doc.rev + 1,
          updated_at = now()
      where household_id = admin.household_id;
  end if;

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'username', v_username);
end;
$$;

grant execute on function public.ensure_my_household() to authenticated;
grant execute on function public.lookup_households_for_login(text) to anon, authenticated;
grant execute on function public.resolve_login(uuid, text) to anon, authenticated;
grant execute on function public.create_household_member(uuid, text, text, text, text, public.app_role[]) to authenticated;
