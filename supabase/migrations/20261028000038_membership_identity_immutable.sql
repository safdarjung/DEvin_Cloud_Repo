-- T-042 fix round 1 (review LOW): 0033's `app.guard_membership_write`
-- checked roles against `new.institution_id` only, and nothing stopped an
-- UPDATE from re-pointing a membership at another user (hand a teacher's
-- access to anyone) or moving it to another institution. A membership's
-- `user_id` and `institution_id` are now fixed once written; every other
-- rule is unchanged. Same function (security invoker), same trigger.

create or replace function app.guard_membership_write()
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
    if new.user_id is distinct from old.user_id or new.institution_id is distinct from old.institution_id then
      raise exception 'code:forbidden' using detail = 'a membership''s user and institution never change';
    end if;
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
