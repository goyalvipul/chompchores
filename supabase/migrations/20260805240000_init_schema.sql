-- ChompChores: initial schema + RLS
-- Safe to apply to a NEW Supabase project only.
-- Does NOT touch the home Docker JSON app used by kids.

create extension if not exists pgcrypto;

create type public.app_role as enum ('chore', 'task', 'admin');
create type public.reward_type as enum ('standard', 'timer');
create type public.redeem_type as enum ('persistent', 'onetime');
create type public.task_status as enum ('pending', 'completed', 'deferred');
create type public.history_type as enum (
  'chore', 'chore-undo', 'reward', 'penalty', 'bonus', 'reset',
  'reminder', 'reminder-missed'
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  username text not null,
  roles public.app_role[] not null default '{chore}',
  sound_pref text not null default 'on' check (sound_pref in ('on', 'off')),
  legacy_id text unique,
  created_at timestamptz not null default now(),
  unique (household_id, username)
);

create table public.household_settings (
  household_id uuid primary key references public.households (id) on delete cascade,
  daily_target numeric(10, 2) not null default 15,
  penalty_pts numeric(10, 2) not null default 5,
  pin_hash text,
  updated_at timestamptz not null default now()
);

create table public.chores (
  id text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  assignee_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  pts numeric(10, 2) not null,
  group_key text,
  created_at timestamptz not null default now()
);

create table public.rewards (
  id text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  assignee_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  type public.reward_type not null default 'standard',
  redeem_type public.redeem_type not null default 'persistent',
  cost numeric(10, 2) not null default 0,
  timer_pts numeric(10, 2),
  timer_hours numeric(10, 2),
  times_used int not null default 0,
  last_used date
);

create table public.one_time_tasks (
  id text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  assignee_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  due_date date not null,
  pts numeric(10, 2) not null default 0,
  priority text not null default 'normal',
  done boolean not null default false
);

create table public.user_progress (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  points numeric(10, 2) not null default 0,
  checked jsonb not null default '{}'::jsonb,
  last_reset_date date
);

create table public.history_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  daily_earned numeric(10, 2) not null default 0,
  daily_spent numeric(10, 2) not null default 0,
  penalty numeric(10, 2) not null default 0,
  unique (user_id, day)
);

create table public.history_entries (
  id uuid primary key default gen_random_uuid(),
  history_day_id uuid not null references public.history_days (id) on delete cascade,
  type public.history_type not null,
  label text not null,
  pts numeric(10, 2) not null default 0,
  entry_time text not null
);

create table public.admin_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  type text not null,
  label text not null,
  detail text,
  day date not null,
  entry_time text not null,
  created_at timestamptz not null default now()
);

create table public.personal_tasks (
  id text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  description text,
  priority text not null default 'medium',
  status public.task_status not null default 'pending',
  date_added date not null,
  eta date,
  reminder text,
  alarm text,
  completed_at timestamptz
);

create table public.cal_feeds (
  id text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  url text not null,
  color text not null,
  events jsonb not null default '[]'::jsonb
);

create index chores_household_assignee_idx on public.chores (household_id, assignee_id);
create index rewards_household_assignee_idx on public.rewards (household_id, assignee_id);
create index one_time_tasks_assignee_idx on public.one_time_tasks (assignee_id, due_date);
create index history_days_user_day_idx on public.history_days (user_id, day desc);
create index admin_log_household_day_idx on public.admin_log (household_id, day desc);
create index personal_tasks_owner_idx on public.personal_tasks (owner_id, status);
create index cal_feeds_owner_idx on public.cal_feeds (owner_id);

-- ── helpers ──────────────────────────────────────────────────────────────────

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.my_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.profiles where id = auth.uid();
$$;

create or replace function public.has_role(role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(role = any (roles), false)
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.is_household_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin');
$$;

create or replace function public.resolve_view_as(view_as uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'not authenticated';
  end if;

  if view_as is null then
    return me.id;
  end if;

  if not ('admin' = any (me.roles)) then
    raise exception 'impersonation requires admin';
  end if;

  select id into target
  from public.profiles
  where id = view_as and household_id = me.household_id;

  if target is null then
    raise exception 'view_as user not in household';
  end if;

  return target;
end;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.households enable row level security;
alter table public.profiles enable row level security;
alter table public.household_settings enable row level security;
alter table public.chores enable row level security;
alter table public.rewards enable row level security;
alter table public.one_time_tasks enable row level security;
alter table public.user_progress enable row level security;
alter table public.history_days enable row level security;
alter table public.history_entries enable row level security;
alter table public.admin_log enable row level security;
alter table public.personal_tasks enable row level security;
alter table public.cal_feeds enable row level security;

create policy households_select on public.households
  for select using (id = public.my_household_id());

create policy profiles_select on public.profiles
  for select using (household_id = public.my_household_id());

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_write on public.profiles
  for all using (
    household_id = public.my_household_id() and public.is_household_admin()
  )
  with check (
    household_id = public.my_household_id() and public.is_household_admin()
  );

create policy settings_select on public.household_settings
  for select using (household_id = public.my_household_id());

create policy settings_admin_update on public.household_settings
  for update using (
    household_id = public.my_household_id() and public.is_household_admin()
  );

create policy chores_select on public.chores
  for select using (
    household_id = public.my_household_id()
    and (
      public.is_household_admin()
      or assignee_id = auth.uid()
    )
  );

create policy chores_admin_write on public.chores
  for all using (
    household_id = public.my_household_id() and public.is_household_admin()
  )
  with check (
    household_id = public.my_household_id() and public.is_household_admin()
  );

create policy rewards_select on public.rewards
  for select using (
    household_id = public.my_household_id()
    and (
      public.is_household_admin()
      or assignee_id = auth.uid()
    )
  );

create policy rewards_admin_write on public.rewards
  for all using (
    household_id = public.my_household_id() and public.is_household_admin()
  )
  with check (
    household_id = public.my_household_id() and public.is_household_admin()
  );

create policy ott_select on public.one_time_tasks
  for select using (
    household_id = public.my_household_id()
    and (
      public.is_household_admin()
      or assignee_id = auth.uid()
    )
  );

create policy ott_admin_write on public.one_time_tasks
  for all using (
    household_id = public.my_household_id() and public.is_household_admin()
  )
  with check (
    household_id = public.my_household_id() and public.is_household_admin()
  );

create policy progress_select on public.user_progress
  for select using (
    household_id = public.my_household_id()
    and (user_id = auth.uid() or public.is_household_admin())
  );

create policy progress_self_update on public.user_progress
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy history_days_select on public.history_days
  for select using (
    user_id = auth.uid()
    or (
      public.is_household_admin()
      and exists (
        select 1 from public.profiles p
        where p.id = history_days.user_id
          and p.household_id = public.my_household_id()
      )
    )
  );

create policy history_entries_select on public.history_entries
  for select using (
    exists (
      select 1 from public.history_days d
      where d.id = history_entries.history_day_id
        and (
          d.user_id = auth.uid()
          or (
            public.is_household_admin()
            and exists (
              select 1 from public.profiles p
              where p.id = d.user_id and p.household_id = public.my_household_id()
            )
          )
        )
    )
  );

create policy admin_log_admin on public.admin_log
  for all using (
    household_id = public.my_household_id() and public.is_household_admin()
  )
  with check (
    household_id = public.my_household_id() and public.is_household_admin()
  );

create policy personal_tasks_owner on public.personal_tasks
  for all using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid() and household_id = public.my_household_id()
  );

create policy cal_feeds_owner on public.cal_feeds
  for all using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid() and household_id = public.my_household_id()
  );

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
