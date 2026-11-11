-- 0134: custom agents — a school's own agent, built on one catalog agent.
--
-- Extends agent_definitions (0095) instead of adding a table: agent_runs.
-- agent_id is a composite FK to agent_definitions (id, institution_id), so
-- a custom agent's runs use the existing run table, guard
-- (app.guard_agent_run_update), approval flow and RLS unchanged.
--
-- A custom row = base_slug (a catalog slug) + a subset of that base's
-- tools/actions + name/summary/instructions/examples. Catalog rows keep
-- every new column null (custom_shape_check). The catalog itself stays
-- code: the subset is validated by the action's Zod schema on write and
-- re-applied by `scopedSpec` (src/modules/agents/catalog.ts) on every run,
-- approve and display, so a widened row can never widen a run. Risk
-- classes and approval rules always come from the catalog, never a column.
--
-- Writes: owner/principal (the roles 0095's agent_definitions_update policy
-- already lets manage agents; action permission `agent.approve`). INSERT is
-- a new policy; UPDATE reuses agent_definitions_update with wider column
-- grants (custom columns on a catalog row fail custom_shape_check). No
-- DELETE grant: runs reference the row, so "delete" archives it
-- (archived_at), and an archived row is frozen by the guard below.
-- `slug` and `created_by` are not grantable: the DB stamps both.

alter table public.agent_definitions
  alter column slug set default ('custom_' || replace(gen_random_uuid()::text, '-', '')),
  add column base_slug text check (base_slug ~ '^[a-z_]{1,40}$'),
  add column name text check (length(name) between 1 and 60),
  add column summary text check (length(summary) between 1 and 120),
  add column instructions text check (length(instructions) between 1 and 2000),
  add column examples text[] check (cardinality(examples) <= 3 and length(array_to_string(examples, '')) <= 270),
  add column tools text[] check (cardinality(tools) between 1 and 10 and length(array_to_string(tools, ',')) <= 600),
  add column actions text[] check (cardinality(actions) <= 10 and length(array_to_string(actions, ',')) <= 600),
  add column created_by uuid default auth.uid() references public.profiles (id),
  add column archived_at timestamptz,
  -- A custom row always has the server-made slug; a catalog row never does.
  add constraint agent_definitions_custom_slug_check
    check ((base_slug is null) = (slug !~ '^custom_[0-9a-f]{32}$')),
  add constraint agent_definitions_custom_shape_check check (
    (base_slug is null and name is null and summary is null and instructions is null and examples is null
      and tools is null and actions is null and created_by is null and archived_at is null)
    or (base_slug is not null and name is not null and summary is not null and instructions is not null
      and examples is not null and tools is not null and actions is not null and created_by is not null)
  );

create unique index agent_definitions_custom_name_key
  on public.agent_definitions (institution_id, lower(name))
  where base_slug is not null and archived_at is null;

-- Row cap per institution (20 live, 200 incl. archived) and frozen archived
-- rows / fixed base + creator. Security invoker: the inserting manager's own
-- RLS already sees every row of their institution, so the count is exact.
create function app.guard_custom_agent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_live integer;
  v_total integer;
begin
  if tg_op = 'UPDATE' then
    if old.archived_at is not null then
      raise exception 'code:invalid_state' using detail = 'This custom agent was deleted and cannot change.';
    end if;
    if new.base_slug is distinct from old.base_slug or new.created_by is distinct from old.created_by then
      raise exception 'code:invalid_state' using detail = 'A custom agent''s base agent and creator cannot change.';
    end if;
    return new;
  end if;

  if new.base_slug is null then
    return new;
  end if;

  -- Serialise one institution's concurrent creates so the cap holds.
  perform pg_advisory_xact_lock(hashtextextended('custom_agents:' || new.institution_id::text, 0));

  select count(*) filter (where d.archived_at is null), count(*)
  into v_live, v_total
  from public.agent_definitions d
  where d.institution_id = new.institution_id and d.base_slug is not null;

  if v_live >= 20 or v_total >= 200 then
    raise exception 'code:invalid_state' using detail = 'This school has reached the limit of 20 custom agents.';
  end if;
  return new;
end;
$$;

create trigger guard_custom_agent
before insert or update on public.agent_definitions
for each row execute function app.guard_custom_agent();

create policy agent_definitions_insert_custom on public.agent_definitions
  for insert to authenticated
  with check (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    and base_slug is not null
    and created_by = (select auth.uid())
  );

revoke all on public.agent_definitions from anon;
grant insert (institution_id, base_slug, name, summary, instructions, examples, tools, actions)
  on public.agent_definitions to authenticated;
grant update (name, summary, instructions, examples, tools, actions, archived_at)
  on public.agent_definitions to authenticated;
