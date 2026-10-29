-- T-027 (lead ruling — one migration allowed on this packet): admissions
-- pipeline/decision RPCs + the state guards they need. 0007 is merged and
-- never edited (CLAUDE.md rule 9); guards land here as new triggers on
-- 0007's tables instead, same shape as 0014 closing 0006's bypasses.
--
-- app.decide_application / app.convert_enquiry / app.add_enquiry_note follow
-- 0009's publish_exam_results shape: role-checked INSIDE app.* itself (no
-- internal same-transaction caller that would be wrongly re-checked), thin
-- public.* wrapper, `app.*` revoked from anon/authenticated/service_role,
-- `public.*` granted to authenticated only. `search_path=''`, qualified
-- names, no dynamic SQL throughout (07 §4).

-- ---------------------------------------------------------------------------
-- app.staff_in_institution(...) + enquiries_insert/enquiries_update policy
-- fix (found while implementing assignEnquiry, packet item 5: "RLS already
-- scope-checks it"). It does not: 0007's enquiries_insert/enquiries_update
-- WITH CHECK scopes `assigned_to` with a bare `exists (select 1 from
-- public.staff s where ...)`, and that subquery is itself subject to
-- `staff`'s own RLS (0004's `staff_select`, which is owner/principal/admin/
-- accountant/exam_controller + own row — admissions is NOT in that list).
-- So an admissions-role caller assigning ANY staff member to an enquiry —
-- the primary user of this feature — got `42501` on every attempt,
-- confirmed empirically before this fix. 0007 is never edited; same
-- drop-policy/create-policy shape as 0014 closing 0006's bypasses. Only the
-- `assigned_to` clause changes, grade_applied_id's clause is untouched.
--
-- Fix round 1 (security review, HIGH): no `public.staff_in_institution`
-- wrapper exists any more — it was a cross-tenant oracle (any authenticated
-- caller could pass an arbitrary `p_institution_id` and learn whether a
-- staff id belongs there, with no membership check at all). `assignEnquiry`
-- now relies entirely on the policy below: the attempted UPDATE either
-- succeeds (same-tenant staff) or raises `42501` (cross-tenant/unknown
-- staff), which the action maps to `not_found`. `app.staff_in_institution`
-- itself is hardened as defense in depth even though it is no longer
-- reachable over PostgREST (app is not PostgREST-exposed, and there is no
-- public.* wrapper for it any more): it now returns false for a caller who
-- is not a member of `p_institution_id`, bypassed only by the trusted
-- `service_role` JWT claim or `session_user='postgres'` — never a bare
-- `security definer` no-check lookup. When called from inside the policies
-- below, `p_institution_id` is always the enquiry's own `institution_id`,
-- which `app.has_role(institution_id, ...)` in the same WITH CHECK already
-- proved the caller is a member of — so this is a no-op for every
-- legitimate caller and closes the hole for any future caller that isn't.
-- ---------------------------------------------------------------------------

create function app.staff_in_institution(p_staff_id uuid, p_institution_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trusted boolean;
begin
  v_trusted := (
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  );

  if not v_trusted and not app.is_member(p_institution_id) then
    return false;
  end if;

  return exists (select 1 from public.staff s where s.id = p_staff_id and s.institution_id = p_institution_id);
end;
$$;

revoke execute on function app.staff_in_institution(uuid, uuid) from public;
-- Required, not optional: this function is called DIRECTLY from the
-- enquiries_insert/enquiries_update WITH CHECK clauses below, which
-- evaluate as the invoking role (`authenticated`) — unlike
-- app.decide_application's internal call to app.admissions_decide_roles()
-- a few sections down, which runs as the SECURITY DEFINER function's
-- owner and needs no grant of its own (verified by revoking each grant
-- inside a rolled-back transaction: revoking THIS one breaks every
-- enquiries insert/update with a non-null assigned_to; revoking
-- admissions_decide_roles' grant breaks nothing).
grant execute on function app.staff_in_institution(uuid, uuid) to authenticated;

drop policy enquiries_insert on public.enquiries;

create policy enquiries_insert on public.enquiries
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and (
      grade_applied_id is null
      or exists (
        select 1 from public.grades g
        where g.id = enquiries.grade_applied_id and g.institution_id = enquiries.institution_id
      )
    )
    and (assigned_to is null or app.staff_in_institution(assigned_to, institution_id))
  );

drop policy enquiries_update on public.enquiries;

create policy enquiries_update on public.enquiries
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and (
      grade_applied_id is null
      or exists (
        select 1 from public.grades g
        where g.id = enquiries.grade_applied_id and g.institution_id = enquiries.institution_id
      )
    )
    and (assigned_to is null or app.staff_in_institution(assigned_to, institution_id))
  );

-- ---------------------------------------------------------------------------
-- app.admissions_decide_roles() — 07 §2.2 `admissions.application.decide`
-- (own/principal/admissions) is narrower than app.staff_roles() AND narrower
-- than the enquiry.read/write/enrol row (which includes admin) — same lesson
-- as 0009's app.exam_write_roles(). application_decisions_insert's RLS
-- policy (0007) already hardcodes this exact array; this just names it.
--
-- Fix round 1 (security review, LOW): no grant to `authenticated` — its
-- only caller is app.decide_application's own internal call, which runs
-- SECURITY DEFINER as the function owner (not as the invoking role), so no
-- EXECUTE grant is needed (verified by revoking it inside a rolled-back
-- transaction: the full decide_application flow still worked). Unlike
-- app.staff_in_institution above, nothing calls this one directly from an
-- RLS policy evaluated as `authenticated`.
-- ---------------------------------------------------------------------------

create function app.admissions_decide_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['owner', 'principal', 'admissions'];
$$;

revoke execute on function app.admissions_decide_roles() from public;

-- ---------------------------------------------------------------------------
-- app.guard_application_decision() — BEFORE UPDATE on applications. A direct
-- write could otherwise set status to offered/accepted/rejected/withdrawn
-- (skipping the application_decisions row and the transition check) exactly
-- the way 0008's app.guard_application_enrolled closes the same hole for
-- `enrolled`. Packet text says "accepted/rejected/waitlisted"; the real
-- check constraint (0007) has no `waitlisted` status, so this guards the
-- four decided states the check constraint actually has instead:
-- offered/accepted/rejected/withdrawn. `enrolled` stays exclusively
-- `guard_application_enrolled`'s job (0008, never edited) — both triggers
-- fire on the same table without conflict.
-- ---------------------------------------------------------------------------

create function app.guard_application_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bypass boolean;
begin
  v_bypass := (
    coalesce(current_setting('app.allow_decide', true), '') = 'on'
    or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  );

  if new.status is distinct from old.status
    and new.status in ('offered', 'accepted', 'rejected', 'withdrawn')
    and not v_bypass
  then
    raise exception 'code:invalid_state' using detail = 'applications.status may only move into offered/accepted/rejected/withdrawn through app.decide_application';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_application_decision() from public;

create trigger guard_application_decision
before update on public.applications
for each row execute function app.guard_application_decision();

-- ---------------------------------------------------------------------------
-- app.guard_enquiry_mutation() — BEFORE UPDATE on enquiries. Two rules in
-- one trigger: (1) status may only become `converted` through
-- app.convert_enquiry (same GUC-bypass shape as guard_application_enrolled);
-- (2) notes is append-only — any direct change to it outside
-- app.add_enquiry_note is rejected (packet item 4). Both share one bypass
-- check (service_role / postgres / the owning RPC's own GUC).
-- ---------------------------------------------------------------------------

create function app.guard_enquiry_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean;
begin
  v_trusted := (
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  );

  if new.status = 'converted'
    and old.status is distinct from new.status
    and coalesce(current_setting('app.allow_convert', true), '') <> 'on'
    and not v_trusted
  then
    raise exception 'code:invalid_state' using detail = 'enquiries.status may only become converted through app.convert_enquiry';
  end if;

  if new.notes is distinct from old.notes
    and coalesce(current_setting('app.allow_notes', true), '') <> 'on'
    and not v_trusted
  then
    raise exception 'code:invalid_state' using detail = 'enquiries.notes is append-only; use app.add_enquiry_note';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_enquiry_mutation() from public;

create trigger guard_enquiry_mutation
before update on public.enquiries
for each row execute function app.guard_enquiry_mutation();

-- ---------------------------------------------------------------------------
-- app.decide_application(...) — 06 §W4. Locks the application, role-checks
-- (admissions.application.decide: admin forbidden), validates the decision
-- against the current status (the same table state.ts's canDecide encodes
-- in TS, duplicated here since plpgsql can't import it), inserts the
-- decision row, flips status under the GUC bypass, audits.
-- ---------------------------------------------------------------------------

create function app.decide_application(p_institution_id uuid, p_application_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_application public.applications;
  v_new_status text;
  v_decision_id uuid;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_decision not in ('offer', 'reject', 'accept', 'withdraw') then
    raise exception 'code:validation_failed' using detail = 'decision must be one of offer, reject, accept, withdraw';
  end if;

  if p_note is not null and length(p_note) > 5000 then
    raise exception 'code:validation_failed' using detail = 'note must be at most 5000 characters';
  end if;

  select * into v_application
  from public.applications
  where id = p_application_id and institution_id = p_institution_id
  for update;

  if v_application.id is null then
    raise exception 'code:not_found' using detail = 'application not found for this institution';
  end if;

  if not app.has_role(v_application.institution_id, app.admissions_decide_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold an admissions.application.decide role for this institution';
  end if;

  v_new_status := case p_decision
    when 'offer' then 'offered'
    when 'reject' then 'rejected'
    when 'accept' then 'accepted'
    when 'withdraw' then 'withdrawn'
  end;

  if not (
    (p_decision = 'offer' and v_application.status in ('under_review', 'interaction_scheduled'))
    or (p_decision = 'reject' and v_application.status = 'under_review')
    or (p_decision = 'accept' and v_application.status = 'offered')
    or (p_decision = 'withdraw' and v_application.status = 'offered')
  ) then
    raise exception 'code:invalid_state' using detail = format('cannot %s an application in status %s', p_decision, v_application.status);
  end if;

  insert into public.application_decisions (institution_id, application_id, decision, decided_by, note)
  values (v_application.institution_id, p_application_id, p_decision, v_caller, p_note)
  returning id into v_decision_id;

  perform set_config('app.allow_decide', 'on', true);
  update public.applications set status = v_new_status where id = p_application_id;

  perform app.audit(
    v_application.institution_id,
    v_caller,
    'admissions.decision',
    'application',
    p_application_id,
    jsonb_build_object('status', v_application.status),
    jsonb_build_object('status', v_new_status),
    jsonb_build_object('decision', p_decision, 'note', p_note, 'decision_id', v_decision_id)
  );

  return jsonb_build_object('application_id', p_application_id, 'status', v_new_status, 'decision_id', v_decision_id);
end;
$$;

revoke execute on function app.decide_application(uuid, uuid, text, text) from public, anon, authenticated;

create function public.decide_application(p_institution_id uuid, p_application_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.decide_application(p_institution_id, p_application_id, p_decision, p_note);
end;
$$;

revoke execute on function public.decide_application(uuid, uuid, text, text) from public, anon;
grant execute on function public.decide_application(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- app.convert_enquiry(...) — 06 §W4. Locks the enquiry, role-checks
-- (admissions.enquiry.write), validates every field (same patterns as
-- 0007's app.submit_public_enquiry: name lengths, phoneIN regex, isoDate),
-- proves grade/academic_year belong to this institution, inserts the
-- application (application_no comes free from 0007's assign_application_no
-- trigger), flips the enquiry to converted under the GUC bypass, audits.
-- ---------------------------------------------------------------------------

create function app.convert_enquiry(
  p_institution_id uuid,
  p_enquiry_id uuid,
  p_applicant jsonb,
  p_guardian jsonb,
  p_grade_id uuid,
  p_academic_year_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_enquiry public.enquiries;
  v_first_name text := trim(coalesce(p_applicant->>'firstName', ''));
  v_dob text := p_applicant->>'dob';
  v_gender text := trim(coalesce(p_applicant->>'gender', ''));
  v_guardian_name text := trim(coalesce(p_guardian->>'fullName', ''));
  v_guardian_phone text := trim(coalesce(p_guardian->>'phone', ''));
  v_relationship text := trim(coalesce(p_guardian->>'relationship', ''));
  v_application_id uuid;
  v_application_no text;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_enquiry
  from public.enquiries
  where id = p_enquiry_id and institution_id = p_institution_id
  for update;

  if v_enquiry.id is null then
    raise exception 'code:not_found' using detail = 'enquiry not found for this institution';
  end if;

  if not app.has_role(v_enquiry.institution_id, array['owner', 'principal', 'admin', 'admissions']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold an admissions.enquiry.write role for this institution';
  end if;

  if v_enquiry.status = 'converted' then
    raise exception 'code:invalid_state' using detail = 'enquiry has already been converted';
  end if;

  if length(v_first_name) < 1 or length(v_first_name) > 200 then
    raise exception 'code:validation_failed' using detail = 'applicant.firstName must be 1-200 characters';
  end if;
  if v_dob is null or v_dob !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'code:validation_failed' using detail = 'applicant.dob must be an ISO date (YYYY-MM-DD)';
  end if;
  if length(v_gender) < 1 or length(v_gender) > 20 then
    raise exception 'code:validation_failed' using detail = 'applicant.gender is required';
  end if;
  if length(v_guardian_name) < 1 or length(v_guardian_name) > 200 then
    raise exception 'code:validation_failed' using detail = 'guardian.fullName must be 1-200 characters';
  end if;
  if v_guardian_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'code:validation_failed' using detail = 'guardian.phone must be a 10-digit Indian mobile number';
  end if;
  if v_relationship not in ('father', 'mother', 'legal_guardian', 'grandparent', 'other') then
    raise exception 'code:validation_failed' using detail = 'guardian.relationship is not valid';
  end if;

  if not exists (select 1 from public.grades g where g.id = p_grade_id and g.institution_id = v_enquiry.institution_id) then
    raise exception 'code:not_found' using detail = 'grade not found for this institution';
  end if;
  if not exists (select 1 from public.academic_years y where y.id = p_academic_year_id and y.institution_id = v_enquiry.institution_id) then
    raise exception 'code:not_found' using detail = 'academic year not found for this institution';
  end if;

  insert into public.applications (institution_id, enquiry_id, applicant, guardian, grade_applied_id, academic_year_id)
  values (v_enquiry.institution_id, p_enquiry_id, p_applicant, p_guardian, p_grade_id, p_academic_year_id)
  returning id, application_no into v_application_id, v_application_no;

  perform set_config('app.allow_convert', 'on', true);
  update public.enquiries set status = 'converted' where id = p_enquiry_id;

  perform app.audit(
    v_enquiry.institution_id,
    v_caller,
    'admissions.enquiry.status',
    'enquiry',
    p_enquiry_id,
    jsonb_build_object('status', v_enquiry.status),
    jsonb_build_object('status', 'converted'),
    jsonb_build_object('application_id', v_application_id, 'application_no', v_application_no)
  );

  return jsonb_build_object('application_id', v_application_id, 'application_no', v_application_no, 'enquiry_id', p_enquiry_id);
end;
$$;

revoke execute on function app.convert_enquiry(uuid, uuid, jsonb, jsonb, uuid, uuid) from public, anon, authenticated;

create function public.convert_enquiry(
  p_institution_id uuid,
  p_enquiry_id uuid,
  p_applicant jsonb,
  p_guardian jsonb,
  p_grade_id uuid,
  p_academic_year_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.convert_enquiry(p_institution_id, p_enquiry_id, p_applicant, p_guardian, p_grade_id, p_academic_year_id);
end;
$$;

revoke execute on function public.convert_enquiry(uuid, uuid, jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.convert_enquiry(uuid, uuid, jsonb, jsonb, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- app.add_enquiry_note(...) — packet item 4. Appends {author, at, text} to
-- enquiries.notes under the GUC bypass; guard_enquiry_mutation above blocks
-- every other path to that column. `v_enquiry.notes` can already hold
-- `app.submit_public_enquiry`'s (0007) single-object `{"message": ...}`
-- shape from the public enquiry form — normalized into a one-element array
-- here rather than touching 0007.
-- ---------------------------------------------------------------------------

create function app.add_enquiry_note(p_institution_id uuid, p_enquiry_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_enquiry public.enquiries;
  v_notes jsonb;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_text is null or length(btrim(p_text)) = 0 or length(p_text) > 2000 then
    raise exception 'code:validation_failed' using detail = 'text is required (max 2000 characters)';
  end if;

  select * into v_enquiry
  from public.enquiries
  where id = p_enquiry_id and institution_id = p_institution_id
  for update;

  if v_enquiry.id is null then
    raise exception 'code:not_found' using detail = 'enquiry not found for this institution';
  end if;

  if not app.has_role(v_enquiry.institution_id, array['owner', 'principal', 'admin', 'admissions']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold an admissions.enquiry.write role for this institution';
  end if;

  if v_enquiry.notes is null then
    v_notes := '[]'::jsonb;
  elsif jsonb_typeof(v_enquiry.notes) = 'array' then
    v_notes := v_enquiry.notes;
  else
    v_notes := jsonb_build_array(v_enquiry.notes);
  end if;

  v_notes := v_notes || jsonb_build_array(jsonb_build_object('author', v_caller, 'at', to_jsonb(now()), 'text', p_text));

  perform set_config('app.allow_notes', 'on', true);
  update public.enquiries set notes = v_notes where id = p_enquiry_id;

  return v_notes;
end;
$$;

revoke execute on function app.add_enquiry_note(uuid, uuid, text) from public, anon, authenticated;

create function public.add_enquiry_note(p_institution_id uuid, p_enquiry_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.add_enquiry_note(p_institution_id, p_enquiry_id, p_text);
end;
$$;

revoke execute on function public.add_enquiry_note(uuid, uuid, text) from public, anon;
grant execute on function public.add_enquiry_note(uuid, uuid, text) to authenticated;
