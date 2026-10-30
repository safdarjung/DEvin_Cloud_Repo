-- T-042 security review (HIGH, found during triage): `memberships_insert`/
-- `memberships_update` (0002) let any owner/principal/admin write any
-- membership of their institution with any role — so an admin could
-- `update memberships set role = 'owner' where user_id = <self>` (or insert
-- a second owner membership for themselves) over PostgREST and gain
-- finance/exam/admissions-decision rights 07 §2.2 withholds from admin;
-- a principal could likewise make themselves owner, though 07 §2.1 says
-- principals don't manage owners. No app action writes memberships yet
-- (member.manage UI is out of the demo), so this only closes the direct path.
--
-- Rules for every non-bypass writer (service_role/postgres bypass, as 0016):
--   * nobody inserts or edits their own membership (no self-escalation,
--     no self re-enable);
--   * a row whose old or new role is `owner` needs an owner caller;
--   * a row whose old or new role is `principal` needs an owner or principal.
-- Security invoker; `app.has_role` is the existing definer RLS helper.

create function app.guard_membership_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_roles text[] := array[new.role];
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_roles := v_roles || old.role;
  end if;

  if new.user_id = app.current_user_id()
    or (tg_op = 'UPDATE' and old.user_id = app.current_user_id())
  then
    raise exception 'code:forbidden' using detail = 'members cannot change their own membership';
  end if;

  if 'owner' = any(v_roles) and not app.has_role(new.institution_id, array['owner']) then
    raise exception 'code:forbidden' using detail = 'only an owner manages owner memberships';
  end if;

  if 'principal' = any(v_roles) and not app.has_role(new.institution_id, array['owner', 'principal']) then
    raise exception 'code:forbidden' using detail = 'only an owner or principal manages principal memberships';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_membership_write() from public;

create trigger guard_membership_write
before insert or update on public.memberships
for each row execute function app.guard_membership_write();
