-- PMF instrumentation for web PWA / mobile (does not touch Docker JSON app)

create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_events_household_created_idx
  on public.app_events (household_id, created_at desc);

create index if not exists app_events_type_created_idx
  on public.app_events (event_type, created_at desc);

alter table public.app_events enable row level security;

create policy app_events_insert_own on public.app_events
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and household_id = public.my_household_id()
  );

create policy app_events_select_admin on public.app_events
  for select to authenticated
  using (
    household_id = public.my_household_id()
    and public.is_household_admin()
  );

create or replace function public.log_app_event(p_type text, p_payload jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  eid uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'not authenticated';
  end if;
  insert into public.app_events (household_id, user_id, event_type, payload)
  values (me.household_id, me.id, p_type, coalesce(p_payload, '{}'::jsonb))
  returning id into eid;
  return eid;
end;
$$;

grant execute on function public.log_app_event(text, jsonb) to authenticated;
