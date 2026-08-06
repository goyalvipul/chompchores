-- Multi-household membership + login without household picker (PWA only).

create table if not exists public.household_memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  username text not null,
  roles public.app_role[] not null default '{chore}',
  display_name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  primary key (user_id, household_id),
  unique (household_id, username)
);

alter table public.household_memberships enable row level security;

create policy household_memberships_select_own on public.household_memberships
  for select to authenticated
  using (user_id = auth.uid());

-- Backfill memberships from existing profiles
insert into public.household_memberships (user_id, household_id, username, roles, display_name, phone, email)
select p.id, p.household_id, p.username, p.roles, p.display_name, p.phone, p.email
from public.profiles p
on conflict do nothing;

-- Keep membership in sync when ensure_my_household creates first house
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
    insert into public.household_memberships (user_id, household_id, username, roles, display_name, phone, email)
    values (me.id, me.household_id, me.username, me.roles, me.display_name, me.phone, me.email)
    on conflict do nothing;
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
    uid, hid, v_username,
    array['admin', 'chore']::public.app_role[],
    coalesce(v_display, v_username), v_phone, v_email
  )
  returning * into me;

  insert into public.household_memberships (user_id, household_id, username, roles, display_name, phone, email)
  values (uid, hid, v_username, array['admin', 'chore']::public.app_role[], coalesce(v_display, v_username), v_phone, v_email)
  on conflict do nothing;

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
        'points', 0, 'checked', '{}'::jsonb, 'history', '[]'::jsonb, 'lastResetDate', null
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

-- Login helper: email or unique username → Auth email (no household picker)
create or replace function public.resolve_login_identifier(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ident text := lower(trim(coalesce(p_identifier, '')));
  p public.profiles;
  auth_email text;
  cnt int;
begin
  if ident = '' then
    raise exception 'identifier required';
  end if;

  if position('@' in ident) > 0 then
    select email into auth_email from auth.users where lower(email) = ident limit 1;
    if auth_email is null then
      -- still allow Auth to reject unknown emails uniformly
      return jsonb_build_object('email', ident);
    end if;
    return jsonb_build_object('email', auth_email);
  end if;

  select count(*) into cnt from public.profiles where lower(username) = ident;
  if cnt = 0 then
    raise exception 'user_not_found';
  end if;
  if cnt > 1 then
    raise exception 'username_ambiguous';
  end if;

  select * into p from public.profiles where lower(username) = ident limit 1;
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

create or replace function public.list_my_households()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  active uuid;
  result jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select household_id into active from public.profiles where id = uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'household_id', h.id,
    'household_name', h.name,
    'username', m.username,
    'roles', m.roles,
    'active', (h.id = active)
  ) order by h.name), '[]'::jsonb)
  into result
  from public.household_memberships m
  join public.households h on h.id = m.household_id
  where m.user_id = uid;

  return result;
end;
$$;

create or replace function public.switch_household(p_household_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.household_memberships;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into m from public.household_memberships
  where user_id = uid and household_id = p_household_id;
  if m.user_id is null then
    raise exception 'not a member';
  end if;

  update public.profiles
    set household_id = m.household_id,
        username = m.username,
        roles = m.roles,
        display_name = m.display_name,
        phone = m.phone,
        email = m.email
    where id = uid;

  return jsonb_build_object('ok', true, 'household_id', m.household_id);
end;
$$;

create or replace function public.create_additional_household(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  hid uuid;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  now_iso text := to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  init_state jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into me from public.profiles where id = uid;
  if me.id is null then
    me := public.ensure_my_household();
  end if;
  if not ('admin' = any(me.roles)) then
    raise exception 'admin required';
  end if;
  if v_name is null then v_name := 'My House'; end if;

  -- Persist current membership snapshot before switching
  insert into public.household_memberships (user_id, household_id, username, roles, display_name, phone, email)
  values (me.id, me.household_id, me.username, me.roles, me.display_name, me.phone, me.email)
  on conflict (user_id, household_id) do update
    set username = excluded.username,
        roles = excluded.roles,
        display_name = excluded.display_name,
        phone = excluded.phone,
        email = excluded.email;

  insert into public.households (name) values (v_name) returning id into hid;
  insert into public.household_settings (household_id, daily_target, penalty_pts)
  values (hid, 15, 5);

  insert into public.household_memberships (user_id, household_id, username, roles, display_name, phone, email)
  values (uid, hid, me.username, array['admin', 'chore']::public.app_role[], me.display_name, me.phone, me.email);

  update public.profiles
    set household_id = hid,
        roles = array['admin', 'chore']::public.app_role[]
    where id = uid;

  -- user_progress is keyed by user_id only — keep one progress row; app_state is per household
  init_state := jsonb_build_object(
    'rev', 1,
    'userScoped', true,
    'dailyTarget', 15,
    'penaltyPts', 5,
    'pinHash', null,
    'users', jsonb_build_array(
      jsonb_build_object(
        'id', uid,
        'username', me.username,
        'passwordHash', '',
        'roles', jsonb_build_array('admin', 'chore'),
        'displayName', coalesce(me.display_name, me.username),
        'phone', me.phone,
        'email', me.email,
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
        'points', 0, 'checked', '{}'::jsonb, 'history', '[]'::jsonb, 'lastResetDate', null
      )
    ),
    'tasks', '[]'::jsonb,
    'calendars', '[]'::jsonb
  );

  insert into public.household_app_state (household_id, state, rev, updated_at)
  values (hid, init_state, 1, now());

  return jsonb_build_object('ok', true, 'household_id', hid, 'household_name', v_name);
end;
$$;

-- Also record membership when admin adds a member
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
    p_user_id, admin.household_id, v_username, v_roles,
    coalesce(nullif(trim(p_display_name), ''), v_username),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_email, '')), '')
  );

  insert into public.household_memberships (user_id, household_id, username, roles, display_name, phone, email)
  values (
    p_user_id, admin.household_id, v_username, v_roles,
    coalesce(nullif(trim(p_display_name), ''), v_username),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_email, '')), '')
  )
  on conflict do nothing;

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
        'rev', 1, 'userScoped', true,
        'users', jsonb_build_array(new_user),
        'userProgress', jsonb_build_object(
          p_user_id::text, jsonb_build_object('points', 0, 'checked', '{}'::jsonb, 'history', '[]'::jsonb)
        )
      ),
      1, now()
    );
  else
    users := coalesce(doc.state->'users', '[]'::jsonb) || jsonb_build_array(new_user);
    update public.household_app_state
      set state = doc.state || jsonb_build_object(
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

grant execute on function public.resolve_login_identifier(text) to anon, authenticated;
grant execute on function public.list_my_households() to authenticated;
grant execute on function public.switch_household(uuid) to authenticated;
grant execute on function public.create_additional_household(text) to authenticated;
