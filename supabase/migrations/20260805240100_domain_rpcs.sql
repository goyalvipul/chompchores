-- Domain RPCs: points math stays server-side (SECURITY DEFINER).

create or replace function public.round2(n numeric)
returns numeric
language sql
immutable
as $$
  select round(coalesce(n, 0) + 0.0000001, 2);
$$;

create or replace function public.ensure_progress(p_user uuid)
returns public.user_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.user_progress;
  hid uuid;
begin
  select household_id into hid from public.profiles where id = p_user;
  if hid is null then
    raise exception 'unknown user';
  end if;

  select * into p from public.user_progress where user_id = p_user;
  if p.user_id is null then
    insert into public.user_progress (user_id, household_id, points, checked)
    values (p_user, hid, 0, '{}'::jsonb)
    returning * into p;
  end if;
  return p;
end;
$$;

create or replace function public.ensure_history_day(p_user uuid, p_day date)
returns public.history_days
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.history_days;
begin
  select * into d from public.history_days where user_id = p_user and day = p_day;
  if d.id is null then
    insert into public.history_days (user_id, day)
    values (p_user, p_day)
    returning * into d;
  end if;
  return d;
end;
$$;

create or replace function public.log_history(
  p_user uuid,
  p_type public.history_type,
  p_label text,
  p_pts numeric,
  p_time text default to_char(now(), 'HH12:MI AM')
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.history_days;
  pts numeric := public.round2(p_pts);
begin
  d := public.ensure_history_day(p_user, (timezone('America/Los_Angeles', now()))::date);
  insert into public.history_entries (history_day_id, type, label, pts, entry_time)
  values (d.id, p_type, p_label, pts, p_time);

  if p_type in ('chore', 'bonus') then
    update public.history_days
    set daily_earned = public.round2(daily_earned + greatest(pts, 0))
    where id = d.id;
  elsif p_type in ('reward', 'penalty') then
    update public.history_days
    set daily_spent = public.round2(daily_spent + abs(pts))
    where id = d.id;
  end if;
end;
$$;

create or replace function public.add_to_bank(p_user uuid, delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.user_progress;
begin
  p := public.ensure_progress(p_user);
  update public.user_progress
  set points = public.round2(points + delta)
  where user_id = p_user
  returning points into p.points;
  return p.points;
end;
$$;

create or replace function public.today_earned(p_user uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.user_progress;
  solo numeric := 0;
  grp numeric := 0;
  ot numeric := 0;
  g text;
  today date := (timezone('America/Los_Angeles', now()))::date;
begin
  p := public.ensure_progress(p_user);

  select coalesce(sum(c.pts), 0) into solo
  from public.chores c
  where c.assignee_id = p_user
    and c.group_key is null
    and coalesce(p.checked ->> c.id, 'false') = 'true';

  for g in
    select distinct group_key from public.chores
    where assignee_id = p_user and group_key is not null
  loop
    if (
      select bool_and(coalesce(p.checked ->> c.id, 'false') = 'true')
      from public.chores c
      where c.assignee_id = p_user and c.group_key = g
    ) then
      grp := public.round2(grp + (
        select coalesce(sum(c.pts), 0) from public.chores c
        where c.assignee_id = p_user and c.group_key = g
      ));
    end if;
  end loop;

  select coalesce(sum(t.pts), 0) into ot
  from public.one_time_tasks t
  where t.assignee_id = p_user and t.due_date = today and t.done;

  return public.round2(solo + grp + ot);
end;
$$;

create or replace function public.get_bootstrap(view_as uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target uuid;
  hid uuid;
  result jsonb;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'not authenticated';
  end if;

  target := public.resolve_view_as(view_as);
  hid := me.household_id;

  select jsonb_build_object(
    'me', to_jsonb(me),
    'viewAs', target,
    'settings', (
      select to_jsonb(s) from public.household_settings s where s.household_id = hid
    ),
    'householdMembers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'username', p.username, 'roles', p.roles
      ) order by p.username), '[]'::jsonb)
      from public.profiles p where p.household_id = hid
    ),
    'chores', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.name), '[]'::jsonb)
      from public.chores c
      where c.household_id = hid
        and (
          ('admin' = any (me.roles) and view_as is null and false) -- unused
          or c.assignee_id = target
          or ('admin' = any (me.roles) and view_as is null)
        )
        and (
          case
            when 'admin' = any (me.roles) and view_as is null then true
            else c.assignee_id = target
          end
        )
    ),
    'rewards', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.name), '[]'::jsonb)
      from public.rewards r
      where r.household_id = hid
        and (
          case
            when 'admin' = any (me.roles) and view_as is null then true
            else r.assignee_id = target
          end
        )
    ),
    'oneTimeTasks', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.due_date), '[]'::jsonb)
      from public.one_time_tasks t
      where t.household_id = hid
        and (
          case
            when 'admin' = any (me.roles) and view_as is null then true
            else t.assignee_id = target
          end
        )
    ),
    'progress', (
      case
        when 'admin' = any (me.roles) and view_as is null then null
        else to_jsonb(public.ensure_progress(target))
      end
    ),
    'historyDays', (
      case
        when 'admin' = any (me.roles) and view_as is null then '[]'::jsonb
        else (
          select coalesce(jsonb_agg(
            to_jsonb(d) || jsonb_build_object(
              'entries', (
                select coalesce(jsonb_agg(to_jsonb(e) order by e.entry_time), '[]'::jsonb)
                from public.history_entries e where e.history_day_id = d.id
              )
            )
            order by d.day desc
          ), '[]'::jsonb)
          from (
            select * from public.history_days
            where user_id = target
            order by day desc
            limit 30
          ) d
        )
      end
    ),
    'adminLog', (
      case when 'admin' = any (me.roles) then (
        select coalesce(jsonb_agg(to_jsonb(a) order by a.day desc, a.created_at desc), '[]'::jsonb)
        from (
          select * from public.admin_log
          where household_id = hid
          order by day desc, created_at desc
          limit 200
        ) a
      ) else '[]'::jsonb end
    ),
    'tasks', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.date_added desc), '[]'::jsonb)
      from public.personal_tasks t
      where t.owner_id = me.id
    ),
    'calFeeds', (
      select coalesce(jsonb_agg(to_jsonb(f) order by f.name), '[]'::jsonb)
      from public.cal_feeds f
      where f.owner_id = me.id
    )
  ) into result;

  -- For dashboard/rewards: when admin has no view_as, return empty assigned lists
  if 'admin' = any (me.roles) and view_as is null then
    result := result || jsonb_build_object(
      'chores', '[]'::jsonb,
      'rewards', '[]'::jsonb,
      'oneTimeTasks', '[]'::jsonb,
      'progress', null,
      'historyDays', '[]'::jsonb,
      'manageChores', (
        select coalesce(jsonb_agg(to_jsonb(c) order by c.name), '[]'::jsonb)
        from public.chores c where c.household_id = hid
      ),
      'manageRewards', (
        select coalesce(jsonb_agg(to_jsonb(r) order by r.name), '[]'::jsonb)
        from public.rewards r where r.household_id = hid
      ),
      'manageOneTimeTasks', (
        select coalesce(jsonb_agg(to_jsonb(t) order by t.due_date), '[]'::jsonb)
        from public.one_time_tasks t where t.household_id = hid
      )
    );
  else
    result := result || jsonb_build_object(
      'manageChores', (
        case when 'admin' = any (me.roles) then (
          select coalesce(jsonb_agg(to_jsonb(c) order by c.name), '[]'::jsonb)
          from public.chores c where c.household_id = hid
        ) else '[]'::jsonb end
      ),
      'manageRewards', (
        case when 'admin' = any (me.roles) then (
          select coalesce(jsonb_agg(to_jsonb(r) order by r.name), '[]'::jsonb)
          from public.rewards r where r.household_id = hid
        ) else '[]'::jsonb end
      ),
      'manageOneTimeTasks', (
        case when 'admin' = any (me.roles) then (
          select coalesce(jsonb_agg(to_jsonb(t) order by t.due_date), '[]'::jsonb)
          from public.one_time_tasks t where t.household_id = hid
        ) else '[]'::jsonb end
      )
    );
  end if;

  return result;
end;
$$;

create or replace function public.toggle_chore(chore_id text, view_as uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  c public.chores;
  p public.user_progress;
  was boolean;
  was_done boolean;
  now_done boolean;
  gp numeric;
  t text := to_char(now(), 'HH12:MI AM');
begin
  target := public.resolve_view_as(view_as);
  select * into c from public.chores where id = chore_id;
  if c.id is null then raise exception 'chore not found'; end if;
  if c.assignee_id <> target and not public.is_household_admin() then
    raise exception 'forbidden';
  end if;
  -- admin may toggle only for the viewed user
  if c.assignee_id <> target then
    raise exception 'chore not assigned to active user';
  end if;

  p := public.ensure_progress(target);
  was := coalesce(p.checked ->> chore_id, 'false') = 'true';

  if c.group_key is null then
    if was then
      p.checked := p.checked - chore_id;
      perform public.add_to_bank(target, -c.pts);
      perform public.log_history(target, 'chore-undo', c.name || ' (unchecked)', -c.pts, t);
    else
      p.checked := p.checked || jsonb_build_object(chore_id, true);
      perform public.add_to_bank(target, c.pts);
      perform public.log_history(target, 'chore', c.name, c.pts, t);
    end if;
  else
    was_done := (
      select bool_and(coalesce(p.checked ->> x.id, 'false') = 'true')
      from public.chores x
      where x.assignee_id = target and x.group_key = c.group_key
    );
    if was then
      p.checked := p.checked - chore_id;
    else
      p.checked := p.checked || jsonb_build_object(chore_id, true);
    end if;
    now_done := (
      select bool_and(coalesce(p.checked ->> x.id, 'false') = 'true')
      from public.chores x
      where x.assignee_id = target and x.group_key = c.group_key
    );
    select coalesce(sum(x.pts), 0) into gp
    from public.chores x
    where x.assignee_id = target and x.group_key = c.group_key;

    if not was_done and now_done then
      perform public.add_to_bank(target, gp);
      perform public.log_history(target, 'chore', 'Group: ' || c.group_key, gp, t);
    elsif was_done and not now_done then
      perform public.add_to_bank(target, -gp);
      perform public.log_history(target, 'chore-undo', 'Group: ' || c.group_key || ' (incomplete)', -gp, t);
    end if;
  end if;

  update public.user_progress set checked = p.checked where user_id = target;

  return public.get_bootstrap(view_as);
end;
$$;

create or replace function public.toggle_one_time(task_id text, view_as uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  t public.one_time_tasks;
  tm text := to_char(now(), 'HH12:MI AM');
begin
  target := public.resolve_view_as(view_as);
  select * into t from public.one_time_tasks where id = task_id;
  if t.id is null then raise exception 'task not found'; end if;
  if t.assignee_id <> target then raise exception 'task not assigned to active user'; end if;

  if t.done then
    update public.one_time_tasks set done = false where id = task_id;
    perform public.add_to_bank(target, -t.pts);
    perform public.log_history(target, 'chore-undo', '📌 ' || t.name || ' (unchecked)', -t.pts, tm);
  else
    update public.one_time_tasks set done = true where id = task_id;
    perform public.add_to_bank(target, t.pts);
    perform public.log_history(target, 'chore', '📌 ' || t.name, t.pts, tm);
  end if;

  return public.get_bootstrap(view_as);
end;
$$;

create or replace function public.redeem_reward(reward_id text, view_as uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  r public.rewards;
  p public.user_progress;
  tm text := to_char(now(), 'HH12:MI AM');
begin
  target := public.resolve_view_as(view_as);
  select * into r from public.rewards where id = reward_id;
  if r.id is null then raise exception 'reward not found'; end if;
  if r.assignee_id <> target then raise exception 'reward not assigned to active user'; end if;
  if r.type = 'timer' then raise exception 'use stop_timer for timer rewards'; end if;

  p := public.ensure_progress(target);
  if public.round2(r.cost - p.points) > 0 then
    raise exception 'insufficient points' using errcode = 'P0001';
  end if;

  perform public.add_to_bank(target, -r.cost);
  perform public.log_history(target, 'reward', r.name, -r.cost, tm);

  if r.redeem_type = 'onetime' then
    delete from public.rewards where id = reward_id;
  else
    update public.rewards
    set times_used = times_used + 1,
        last_used = (timezone('America/Los_Angeles', now()))::date
    where id = reward_id;
  end if;

  return public.get_bootstrap(view_as);
end;
$$;

create or replace function public.stop_timer(
  reward_id text,
  elapsed_sec numeric,
  view_as uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  r public.rewards;
  pps numeric;
  pd numeric;
  tm text := to_char(now(), 'HH12:MI AM');
  ts text;
begin
  target := public.resolve_view_as(view_as);
  select * into r from public.rewards where id = reward_id;
  if r.id is null then raise exception 'reward not found'; end if;
  if r.assignee_id <> target then raise exception 'reward not assigned to active user'; end if;
  if r.type <> 'timer' then raise exception 'not a timer reward'; end if;

  pps := r.timer_pts / (r.timer_hours * 3600);
  pd := public.round2(ceil(elapsed_sec * pps * 100) / 100.0);
  if elapsed_sec >= 60 then
    ts := floor(elapsed_sec / 60)::text || 'm ' || floor(elapsed_sec::numeric % 60)::text || 's';
  else
    ts := floor(elapsed_sec)::text || 's';
  end if;

  if pd > 0 then
    perform public.add_to_bank(target, -pd);
    perform public.log_history(target, 'reward', '⏱ ' || r.name || ' — ' || ts, -pd, tm);
  end if;

  if r.redeem_type = 'onetime' then
    delete from public.rewards where id = reward_id;
  else
    update public.rewards
    set times_used = times_used + 1,
        last_used = (timezone('America/Los_Angeles', now()))::date
    where id = reward_id;
  end if;

  return public.get_bootstrap(view_as) || jsonb_build_object('timerPts', pd, 'timerLabel', ts);
end;
$$;

create or replace function public.adjust_points(delta numeric, view_as uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  d numeric := public.round2(delta);
  tm text := to_char(now(), 'HH12:MI AM');
begin
  if not public.is_household_admin() then raise exception 'admin only'; end if;
  target := public.resolve_view_as(view_as);
  if d = 0 then raise exception 'delta must be non-zero'; end if;
  perform public.add_to_bank(target, d);
  perform public.log_history(
    target, 'bonus',
    'Manual: ' || case when d > 0 then '+' else '' end || d::text || ' pts',
    d, tm
  );
  return public.get_bootstrap(view_as);
end;
$$;

create or replace function public.reset_points(view_as uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if not public.is_household_admin() then raise exception 'admin only'; end if;
  target := public.resolve_view_as(view_as);
  update public.user_progress set points = 0 where user_id = target;
  return public.get_bootstrap(view_as);
end;
$$;

create or replace function public.reset_day(view_as uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  p public.user_progress;
  c public.chores;
  ot public.one_time_tasks;
  today date := (timezone('America/Los_Angeles', now()))::date;
  tm text := to_char(now(), 'HH12:MI AM');
  g text;
  gp numeric;
begin
  if not public.is_household_admin() then raise exception 'admin only'; end if;
  target := public.resolve_view_as(view_as);
  p := public.ensure_progress(target);

  for c in
    select * from public.chores
    where assignee_id = target and group_key is null
      and coalesce(p.checked ->> id, 'false') = 'true'
  loop
    perform public.add_to_bank(target, -c.pts);
  end loop;

  for g in
    select distinct group_key from public.chores
    where assignee_id = target and group_key is not null
  loop
    if (
      select bool_and(coalesce(p.checked ->> x.id, 'false') = 'true')
      from public.chores x where x.assignee_id = target and x.group_key = g
    ) then
      select coalesce(sum(x.pts), 0) into gp
      from public.chores x where x.assignee_id = target and x.group_key = g;
      perform public.add_to_bank(target, -gp);
    end if;
  end loop;

  for ot in
    select * from public.one_time_tasks
    where assignee_id = target and due_date = today and done
  loop
    perform public.add_to_bank(target, -ot.pts);
    update public.one_time_tasks set done = false where id = ot.id;
  end loop;

  update public.user_progress
  set checked = '{}'::jsonb, last_reset_date = today
  where user_id = target;

  perform public.log_history(target, 'reset', 'Day manually reset', 0, tm);
  return public.get_bootstrap(view_as);
end;
$$;

create or replace function public.midnight_reset_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.user_progress;
  today date := (timezone('America/Los_Angeles', now()))::date;
  earned numeric;
  target_pts numeric;
  penalty numeric;
  d public.history_days;
  hid uuid;
begin
  p := public.ensure_progress(p_user);
  if p.last_reset_date = today then
    return;
  end if;

  select household_id into hid from public.profiles where id = p_user;
  select daily_target, penalty_pts into target_pts, penalty
  from public.household_settings where household_id = hid;

  if p.last_reset_date is not null and p.last_reset_date <> today then
    earned := public.today_earned(p_user);
    if earned < coalesce(target_pts, 0) and coalesce(penalty, 0) > 0 then
      perform public.add_to_bank(p_user, -penalty);
      select * into d from public.history_days
      where user_id = p_user and day = p.last_reset_date;
      if d.id is null then
        insert into public.history_days (user_id, day)
        values (p_user, p.last_reset_date)
        returning * into d;
      end if;
      insert into public.history_entries (history_day_id, type, label, pts, entry_time)
      values (
        d.id, 'penalty',
        'Target missed (' || earned::text || '/' || target_pts::text || ' pts)',
        public.round2(-penalty), '23:59'
      );
      update public.history_days
      set penalty = public.round2(coalesce(history_days.penalty, 0) + penalty)
      where id = d.id;
    end if;
  end if;

  update public.user_progress
  set checked = '{}'::jsonb, last_reset_date = today
  where user_id = p_user;
end;
$$;

create or replace function public.midnight_reset_all()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid;
  n int := 0;
begin
  for u in select id from public.profiles loop
    perform public.midnight_reset_user(u);
    n := n + 1;
  end loop;
  return n;
end;
$$;

grant execute on function public.get_bootstrap(uuid) to authenticated;
grant execute on function public.toggle_chore(text, uuid) to authenticated;
grant execute on function public.toggle_one_time(text, uuid) to authenticated;
grant execute on function public.redeem_reward(text, uuid) to authenticated;
grant execute on function public.stop_timer(text, numeric, uuid) to authenticated;
grant execute on function public.adjust_points(numeric, uuid) to authenticated;
grant execute on function public.reset_points(uuid) to authenticated;
grant execute on function public.reset_day(uuid) to authenticated;
grant execute on function public.midnight_reset_all() to service_role;
