-- T-042 / DBT-20: 0008/0016's guards are BEFORE UPDATE only, so a direct
-- PostgREST INSERT by an `applications` writer (owner/principal/admin/
-- admissions) could still create a row already `accepted`/`enrolled` (no
-- application_decisions row; `public.enrol_applicant` would then enrol it),
-- and `app.assign_application_no` (0007) kept any client-supplied
-- application_no, so a caller could pre-claim or forge a number.
--
-- Untrusted callers (anything but the service_role JWT or a postgres
-- session — same bypass shape as 0016's guards; never a null uid, lesson 5):
--   * INSERT must start at `submitted` (the column default; convert_enquiry
--     never sets it);
--   * application_no is always taken from the sequence on INSERT;
--   * application_no never changes on UPDATE.
-- The seed (service_role) and fixtures (postgres) keep inserting any status
-- and number. No new security definer: `assign_application_no` is replaced
-- in place (same signature), the new guard is security invoker.

create or replace function app.assign_application_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.application_no is null
    or not (
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or session_user = 'postgres'
    )
  then
    new.application_no := app.next_sequence(new.institution_id, 'application_no');
  end if;
  return new;
end;
$$;

create function app.guard_application_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status <> 'submitted' then
    raise exception 'code:invalid_state' using detail = 'applications are created as submitted; later states go through the decision/enrol RPCs';
  end if;

  if tg_op = 'UPDATE' and new.application_no is distinct from old.application_no then
    raise exception 'code:invalid_state' using detail = 'application_no is assigned once and never changes';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_application_write() from public;

create trigger guard_application_write
before insert or update on public.applications
for each row execute function app.guard_application_write();
