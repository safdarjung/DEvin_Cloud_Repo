-- 0133 made app.stamp_health_updated_by() fire on INSERT as well as UPDATE. It calls
-- app.current_user_id(), which service_role may not execute, and Postgres checks that
-- privilege when the expression is set up, not when the branch runs. So every
-- service-role insert into health_profiles / health_visits / vaccinations (seed, jobs)
-- failed with "permission denied for function current_user_id".
--
-- A trigger function fires whatever the caller's EXECUTE rights are, so running it as
-- its owner is enough: the id still comes from the caller's JWT claims.

create or replace function app.stamp_health_updated_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Never client-supplied: empty on insert (recorded_by names the author), the caller on update.
  new.updated_by := case when tg_op = 'INSERT' then null else app.current_user_id() end;
  return new;
end;
$$;

revoke execute on function app.stamp_health_updated_by() from public;
