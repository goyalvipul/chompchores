-- Run once AFTER seed_demo_household.sql and AFTER migration 20260806170000.
-- Creates the full-app JSON document used by the PWA clone.
-- Safe to re-run: upserts by household_id.

insert into public.household_app_state (household_id, state, rev, updated_at)
select
  h.id,
  jsonb_build_object(
    'points', 0,
    'chores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'pts', c.pts,
        'group', c.group_key,
        'userId', c.assignee_id
      ) order by c.name)
      from public.chores c where c.household_id = h.id
    ), '[]'::jsonb),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'type', r.type,
        'redeemType', r.redeem_type,
        'cost', r.cost,
        'timerPts', r.timer_pts,
        'timerHours', r.timer_hours,
        'timesUsed', r.times_used,
        'userId', r.assignee_id
      ) order by r.name)
      from public.rewards r where r.household_id = h.id
    ), '[]'::jsonb),
    'checked', '{}'::jsonb,
    'history', '[]'::jsonb,
    'adminLog', '[]'::jsonb,
    'oneTimeTasks', '[]'::jsonb,
    'calFeeds', '[]'::jsonb,
    'tasks', '[]'::jsonb,
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'roles', p.roles,
        'soundPref', p.sound_pref,
        'createdAt', p.created_at,
        'passwordHash', ''
      ) order by p.username)
      from public.profiles p where p.household_id = h.id
    ), '[]'::jsonb),
    'userProgress', coalesce((
      select jsonb_object_agg(up.user_id::text, jsonb_build_object(
        'points', up.points,
        'checked', up.checked,
        'lastResetDate', up.last_reset_date,
        'history', '[]'::jsonb
      ))
      from public.user_progress up where up.household_id = h.id
    ), '{}'::jsonb),
    'userScoped', true,
    'rev', 1,
    'settings', jsonb_build_object(
      'dailyTarget', coalesce(s.daily_target, 10),
      'penaltyPts', coalesce(s.penalty_pts, 5),
      'pin', '1234'
    ),
    'lastResetDate', null
  ),
  1,
  now()
from public.households h
left join public.household_settings s on s.household_id = h.id
on conflict (household_id) do update
  set state = excluded.state,
      rev = greatest(public.household_app_state.rev, 1),
      updated_at = now();
