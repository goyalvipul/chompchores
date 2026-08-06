-- Full-app state document per household (enables full UI clone of index.html).
-- Live Docker JSON app is NOT touched. Midnight edge function should prefer
-- normalized RPCs later; for now client midnight is disabled when using cloud,
-- and midnight_reset_all remains for normalized progress tables.

create table if not exists public.household_app_state (
  household_id uuid primary key references public.households (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.household_app_state enable row level security;

create policy household_app_state_select on public.household_app_state
  for select to authenticated
  using (household_id = public.my_household_id());

-- Direct writes blocked — use security definer RPCs only
create policy household_app_state_no_insert on public.household_app_state
  for insert to authenticated with check (false);
create policy household_app_state_no_update on public.household_app_state
  for update to authenticated using (false);
create policy household_app_state_no_delete on public.household_app_state
  for delete to authenticated using (false);

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
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'not authenticated';
  end if;

  select * into doc from public.household_app_state where household_id = me.household_id;
  if doc.household_id is null then
    return jsonb_build_object(
      'rev', 0,
      'state', null,
      'me', jsonb_build_object(
        'id', me.id,
        'username', me.username,
        'roles', me.roles
      )
    );
  end if;

  return jsonb_build_object(
    'rev', doc.rev,
    'state', doc.state,
    'me', jsonb_build_object(
      'id', me.id,
      'username', me.username,
      'roles', me.roles
    )
  );
end;
$$;

create or replace function public.save_app_state(p_state jsonb, p_expected_rev bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  doc public.household_app_state;
  new_rev bigint;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'not authenticated';
  end if;

  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'invalid state';
  end if;

  -- Block schema-downgrade style wipes (missing userProgress when rev>0)
  if coalesce(p_expected_rev, 0) > 0
     and (p_state->'userProgress') is null
     and coalesce(p_state->>'userScoped', 'false') <> 'true' then
    raise exception 'stale_or_invalid_state';
  end if;

  select * into doc from public.household_app_state where household_id = me.household_id for update;

  if doc.household_id is null then
    new_rev := 1;
    insert into public.household_app_state (household_id, state, rev, updated_at)
    values (me.household_id, p_state || jsonb_build_object('rev', new_rev), new_rev, now());
  else
    if doc.rev <> coalesce(p_expected_rev, 0) then
      raise exception 'revision_conflict' using errcode = 'P0001';
    end if;
    new_rev := doc.rev + 1;
    update public.household_app_state
      set state = p_state || jsonb_build_object('rev', new_rev),
          rev = new_rev,
          updated_at = now()
      where household_id = me.household_id;
  end if;

  return jsonb_build_object('ok', true, 'rev', new_rev);
end;
$$;

grant execute on function public.get_app_state() to authenticated;
grant execute on function public.save_app_state(jsonb, bigint) to authenticated;
