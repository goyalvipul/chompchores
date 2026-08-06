-- Admin-only founders + sync role edits to profiles/memberships (PWA).

create or replace function public.update_member_roles(p_user_id uuid, p_roles public.app_role[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  admin public.profiles;
  target public.profiles;
  v_roles public.app_role[];
begin
  select * into admin from public.profiles where id = auth.uid();
  if admin.id is null or not ('admin' = any(admin.roles)) then
    raise exception 'admin required';
  end if;
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  v_roles := coalesce(p_roles, array[]::public.app_role[]);
  -- normalize: drop invalid, disallow chore+task
  v_roles := array(
    select distinct r from unnest(v_roles) as r
    where r in ('chore'::public.app_role, 'task'::public.app_role, 'admin'::public.app_role)
  );
  if 'chore' = any(v_roles) and 'task' = any(v_roles) then
    v_roles := array_remove(v_roles, 'task'::public.app_role);
  end if;
  if coalesce(array_length(v_roles, 1), 0) = 0 then
    raise exception 'at least one role required';
  end if;

  select * into target from public.profiles
  where id = p_user_id and household_id = admin.household_id;
  if target.id is null then
    raise exception 'user not in household';
  end if;

  -- Keep at least one admin in the household
  if ('admin' = any(target.roles)) and not ('admin' = any(v_roles)) then
    if (
      select count(*) from public.profiles
      where household_id = admin.household_id and 'admin' = any(roles)
    ) <= 1 then
      raise exception 'cannot remove last admin';
    end if;
  end if;

  update public.profiles set roles = v_roles where id = p_user_id;

  update public.household_memberships
    set roles = v_roles
    where user_id = p_user_id and household_id = admin.household_id;

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'roles', to_jsonb(v_roles));
end;
$$;

grant execute on function public.update_member_roles(uuid, public.app_role[]) to authenticated;

-- New signups: admin only (no chore/task required)
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
  admin_roles public.app_role[] := array['admin']::public.app_role[];
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
  values (uid, hid, v_username, admin_roles, coalesce(v_display, v_username), v_phone, v_email)
  returning * into me;

  insert into public.household_memberships (user_id, household_id, username, roles, display_name, phone, email)
  values (uid, hid, v_username, admin_roles, coalesce(v_display, v_username), v_phone, v_email)
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
        'roles', jsonb_build_array('admin'),
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
  admin_roles public.app_role[] := array['admin']::public.app_role[];
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
  values (uid, hid, me.username, admin_roles, me.display_name, me.phone, me.email);

  update public.profiles
    set household_id = hid,
        roles = admin_roles
    where id = uid;

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
        'roles', jsonb_build_array('admin'),
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
