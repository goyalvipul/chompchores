-- Run AFTER you create an Auth user in Supabase Dashboard (Authentication → Users → Add user).
-- Replace the UUID below with that user's id (Auth → Users → copy UUID).
-- Safe for a NEW empty Supabase project only — never run against production kids JSON.

-- Example:
--   \set auth_user_id 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

do $$
declare
  auth_user_id uuid := '2909dc08-84d4-478f-905c-5564a832817c'; -- your Auth user UUID
  hid uuid;
begin
  if auth_user_id = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Replace auth_user_id with your Supabase Auth user UUID before running';
  end if;

  insert into public.households (name)
  values ('Demo Family')
  returning id into hid;

  insert into public.household_settings (household_id, daily_target, penalty_pts)
  values (hid, 10, 5);

  insert into public.profiles (id, household_id, username, roles)
  values (auth_user_id, hid, 'admin', array['admin','chore']::public.app_role[]);

  insert into public.user_progress (user_id, household_id, points, checked)
  values (auth_user_id, hid, 0, '{}'::jsonb);

  insert into public.chores (id, household_id, assignee_id, name, pts, group_key) values
    ('demo-make-bed', hid, auth_user_id, 'Make Bed', 1, 'Daily'),
    ('demo-brush', hid, auth_user_id, 'Brush teeth', 1, 'Daily'),
    ('demo-dishes', hid, auth_user_id, 'Unload dishwasher', 2, null);

  insert into public.rewards (id, household_id, assignee_id, name, type, redeem_type, cost)
  values ('demo-screen', hid, auth_user_id, '30 min screen time', 'standard', 'persistent', 5);

  raise notice 'Demo household ready. Sign in to the PWA with that Auth user email/password.';
end $$;
