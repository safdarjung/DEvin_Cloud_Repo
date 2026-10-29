-- P-01 (lead, not in original backlog): RLS performance. Measured on the
-- seeded demo tenant (4,320 attendance_sessions, 181,440 attendance_records):
-- count(*) through RLS took up to 25.5 s for sessions and >30 s (PostgREST's
-- ~8 s statement timeout) for records, for teacher/guardian/admissions roles.
-- Root cause: every policy called a SECURITY DEFINER helper
-- (app.has_role/app.teaches_section/app.guardian_student_ids/
-- app.own_student_id/app.teacher_sees_guardian) with a per-row argument
-- (institution_id, class_section_id, ...). Postgres cannot inline a
-- SECURITY DEFINER function, so each call re-ran its membership lookup for
-- every row scanned.
--
-- Fix (Supabase's documented RLS performance pattern): add row-independent
-- helpers that return the caller's whole set once, wrap each call in
-- `(select ...)` so Postgres caches it as an InitPlan instead of
-- re-evaluating it per row, and compare row columns against the cached
-- array/set with `= any(...)` (index/hash lookup) instead of calling a
-- function with that row's column as an argument. Every rewritten policy
-- keeps exactly the same semantics as before — same role sets, same
-- `with check` clauses, same scope joins — just restructured so the
-- planner can cache the lookup.
--
-- Old helpers (app.has_role, app.teaches_section, app.guardian_student_ids,
-- app.own_student_id, app.teacher_sees_guardian) are left in place: they are
-- still used by write policies and tables not rewritten here (students/
-- guardians/guardian_students/class_sections/subject_assignments/enrolments/
-- assignments INSERT/UPDATE, fee_* tables), none of which take a per-row
-- hot-path hit at demo scale (single-row writes, or small tables).

-- ---------------------------------------------------------------------------
-- New row-independent helpers (05 §5, D4 style — stable, security definer,
-- search_path pinned, fully qualified names). Each returns the caller's
-- whole active-membership-derived set in one call; policies wrap the call
-- in `(select ...)` so Postgres evaluates it once per statement (InitPlan)
-- instead of once per row, and compare the row's column against the
-- returned array with `= any(...)`.
-- ---------------------------------------------------------------------------

-- Returns `setof uuid` (not `uuid[]`) so a policy's `col = any((select
-- app.my_institution_ids(...)))` is Postgres's documented `= ANY(subquery)`
-- form — a genuine multi-row scalar subquery, which the planner caches as
-- an InitPlan. A single-row `uuid[]`-typed subquery doesn't satisfy ANY's
-- subquery form (42883: uuid = uuid[]); same reasoning for the other three
-- set-valued helpers below.
create function app.my_institution_ids(p_roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.institution_id
  from public.memberships m
  where m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.role = any(p_roles);
$$;

revoke execute on function app.my_institution_ids(text[]) from public;
grant execute on function app.my_institution_ids(text[]) to authenticated;
comment on function app.my_institution_ids(text[]) is
  'RLS perf helper (P-01): institutions where the caller holds one of p_roles. Called as (select app.my_institution_ids(...)) inside policies so Postgres caches it once per statement instead of once per row.';

create function app.my_taught_section_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct cs.id
  from public.memberships m
  join public.class_sections cs on cs.institution_id = m.institution_id
  where m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.staff_id is not null
    and (
      cs.class_teacher_id = m.staff_id
      or exists (
        select 1 from public.subject_assignments sa
        where sa.class_section_id = cs.id and sa.teacher_id = m.staff_id
      )
    );
$$;

revoke execute on function app.my_taught_section_ids() from public;
grant execute on function app.my_taught_section_ids() to authenticated;
comment on function app.my_taught_section_ids() is
  'RLS perf helper (P-01): class_section ids the caller teaches (class teacher or any subject_assignments row), same scope as app.teaches_section but row-independent. Called as (select app.my_taught_section_ids()) inside policies.';

create function app.my_taught_section_subjects()
returns table (class_section_id uuid, subject_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct sa.class_section_id, sa.subject_id
  from public.subject_assignments sa
  join public.memberships m on m.staff_id = sa.teacher_id
  where m.user_id = app.current_user_id()
    and m.status = 'active';
$$;

revoke execute on function app.my_taught_section_subjects() from public;
grant execute on function app.my_taught_section_subjects() to authenticated;
comment on function app.my_taught_section_subjects() is
  'RLS perf helper (P-01): (class_section_id, subject_id) pairs the caller teaches via subject_assignments — the subject-level scope marks needs (DBT-19: section-level app.teaches_section is too broad for marks). Called from inside the `marks` policies.';

-- Fix round 1 (security review, CRITICAL): both branches now require the
-- row's own institution_id to match the caller's membership institution_id
-- — `guardian_students.institution_id` is a denormalized column with no FK/
-- trigger tying it to the guardian's or student's real institution, so a
-- mismatched row (guardian_id from institution A, institution_id/student_id
-- from institution B) previously let a guardian read another institution's
-- student. Same shape the old per-row app.guardian_student_ids(p_institution_id)
-- achieved implicitly by being invoked once per candidate row with that
-- row's own institution_id.
create function app.my_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gs.student_id
  from public.memberships m
  join public.guardian_students gs
    on gs.guardian_id = m.guardian_id
   and gs.institution_id = m.institution_id
  where m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.guardian_id is not null
  union
  select m.student_id
  from public.memberships m
  join public.students st
    on st.id = m.student_id
   and st.institution_id = m.institution_id
  where m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.student_id is not null;
$$;

revoke execute on function app.my_student_ids() from public;
grant execute on function app.my_student_ids() to authenticated;
comment on function app.my_student_ids() is
  'RLS perf helper (P-01): student ids the caller may see as guardian (linked children) or as the student themself — row-independent union of app.guardian_student_ids + app.own_student_id. Called as (select app.my_student_ids()) inside policies.';

create function app.my_student_section_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.class_section_id
  from public.enrolments e
  where e.status = 'active'
    and e.student_id = any((select app.my_student_ids()));
$$;

revoke execute on function app.my_student_section_ids() from public;
grant execute on function app.my_student_section_ids() to authenticated;
comment on function app.my_student_section_ids() is
  'RLS perf helper (P-01): active class_section ids of app.my_student_ids() — the sections a guardian/student may read via their child''s/own current enrolment. Called as (select app.my_student_section_ids()) inside policies.';

-- ---------------------------------------------------------------------------
-- attendance_sessions / attendance_records / attendance_corrections (0006)
-- ---------------------------------------------------------------------------

drop policy attendance_sessions_select on public.attendance_sessions;
create policy attendance_sessions_select on public.attendance_sessions
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'exam_controller'])))
    or class_section_id = any((select app.my_taught_section_ids()))
    or exists (
      select 1 from public.enrolments e
      where e.class_section_id = attendance_sessions.class_section_id
        and e.status = 'active'
        and e.student_id = any((select app.my_student_ids()))
    )
  );

drop policy attendance_sessions_insert on public.attendance_sessions;
create policy attendance_sessions_insert on public.attendance_sessions
  for insert to authenticated
  with check (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or class_section_id = any((select app.my_taught_section_ids()))
  );

-- Current shape is 0014's (not 0006's): `status <> 'submitted'` on both
-- sides — a session can only become `submitted` through
-- public.submit_attendance, never a direct UPDATE.
drop policy attendance_sessions_update on public.attendance_sessions;
create policy attendance_sessions_update on public.attendance_sessions
  for update to authenticated
  using (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or class_section_id = any((select app.my_taught_section_ids()))
    )
    and status <> 'submitted'
  )
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or class_section_id = any((select app.my_taught_section_ids()))
    )
    and status <> 'submitted'
  );

-- Teacher branch deliberately has NO `s.institution_id =
-- attendance_records.institution_id` correlation (unlike the insert/update
-- policies below, where it's cheap and kept for defense in depth):
-- correlating this subquery to the outer row turns `session_id in (...)`
-- into a nested-loop semi join that re-scans attendance_sessions once per
-- attendance_records row — measured 80s for 181,440 rows (EXPLAIN ANALYZE:
-- "Seq Scan on attendance_sessions ... loops=181440"). Dropping the
-- correlation lets Postgres hash the (uncorrelated) subquery once and
-- probe it per row instead. Safe without the institution check: a
-- `class_section_id`/`session_id` value is a uuid primary key that can
-- only ever belong to one institution, so matching it is already
-- institution-scoped — same reasoning the `= any((select app.my_*_ids()))`
-- arrays themselves already rely on throughout this migration.
drop policy attendance_records_select on public.attendance_records;
create policy attendance_records_select on public.attendance_records
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'exam_controller'])))
    or session_id in (
      select s.id from public.attendance_sessions s
      where s.class_section_id = any((select app.my_taught_section_ids()))
    )
    or student_id = any((select app.my_student_ids()))
  );

-- Current shape is 0014's (not 0006's): both policies also require
-- `s.status = 'open'` — once a session is submitted, records are writable
-- only through public.correct_attendance.
drop policy attendance_records_insert on public.attendance_records;
create policy attendance_records_insert on public.attendance_records
  for insert to authenticated
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or session_id in (
        select s.id from public.attendance_sessions s
        where s.class_section_id = any((select app.my_taught_section_ids()))
          and s.institution_id = attendance_records.institution_id
      )
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrolments e on e.class_section_id = s.class_section_id
      where s.id = attendance_records.session_id
        and s.status = 'open'
        and e.institution_id = attendance_records.institution_id
        and e.student_id = attendance_records.student_id
    )
  );

drop policy attendance_records_update on public.attendance_records;
create policy attendance_records_update on public.attendance_records
  for update to authenticated
  using (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or session_id in (
        select s.id from public.attendance_sessions s
        where s.class_section_id = any((select app.my_taught_section_ids()))
          and s.institution_id = attendance_records.institution_id
      )
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrolments e on e.class_section_id = s.class_section_id
      where s.id = attendance_records.session_id
        and s.status = 'open'
        and e.institution_id = attendance_records.institution_id
        and e.student_id = attendance_records.student_id
    )
  )
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or session_id in (
        select s.id from public.attendance_sessions s
        where s.class_section_id = any((select app.my_taught_section_ids()))
          and s.institution_id = attendance_records.institution_id
      )
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrolments e on e.class_section_id = s.class_section_id
      where s.id = attendance_records.session_id
        and s.status = 'open'
        and e.institution_id = attendance_records.institution_id
        and e.student_id = attendance_records.student_id
    )
  );

drop policy attendance_corrections_select on public.attendance_corrections;
create policy attendance_corrections_select on public.attendance_corrections
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'exam_controller'])))
    or exists (
      select 1
      from public.attendance_records r
      join public.attendance_sessions s on s.id = r.session_id
      where r.id = attendance_corrections.record_id
        and s.class_section_id = any((select app.my_taught_section_ids()))
    )
    or exists (
      select 1 from public.attendance_records r
      where r.id = attendance_corrections.record_id
        and r.student_id = any((select app.my_student_ids()))
    )
  );

-- attendance_corrections has no INSERT policy at all since 0014 (writes
-- are public.correct_attendance-only, security definer, bypasses RLS) —
-- nothing to rewrite here.

-- ---------------------------------------------------------------------------
-- students / guardians / guardian_students (0004) — SELECT only; writes
-- are single-row and keep app.has_role/app.guardian_student_ids/
-- app.own_student_id unchanged.
-- ---------------------------------------------------------------------------

drop policy students_select on public.students;
create policy students_select on public.students
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or id = any((select app.my_student_ids()))
  );

drop policy guardians_select on public.guardians;
create policy guardians_select on public.guardians
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant'])))
    or user_id = (select app.current_user_id())
    -- Fix round 1 (security review, CRITICAL, defense in depth alongside
    -- app.my_student_ids()): `gs.institution_id = e.institution_id` so a
    -- guardian_students row whose own institution_id doesn't match the
    -- enrolment it's joined to (same denormalized-column attack the
    -- review found) can't leak that row's guardian_id to the teacher.
    or id = any((
      select gs.guardian_id
      from public.guardian_students gs
      join public.enrolments e on e.student_id = gs.student_id and e.status = 'active' and e.institution_id = gs.institution_id
      where e.class_section_id = any((select app.my_taught_section_ids()))
    ))
  );

-- Fix round 1 (security review, CRITICAL): the guardian_id branch now
-- correlates to this row's own institution_id (and requires an active
-- membership) — without it, a guardian_students row with a mismatched
-- institution_id (institution B) but a guardian_id equal to the caller's
-- real (institution A) guardian identity matched this predicate on
-- guardian_id alone, exposing that institution-B row (and the student_id
-- it links to) to the caller. guardian_students is small (~3k rows in the
-- demo), so this correlation costs nothing like attendance_records' did.
drop policy guardian_students_select on public.guardian_students;
create policy guardian_students_select on public.guardian_students
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or student_id = any((select app.my_student_ids()))
    or guardian_id = any((
      select m.guardian_id
      from public.memberships m
      where m.user_id = (select app.current_user_id())
        and m.guardian_id is not null
        and m.status = 'active'
        and m.institution_id = guardian_students.institution_id
    ))
  );

-- Fix round 1 (security review, CRITICAL): close the write side that let
-- the mismatched-institution row above get created in the first place —
-- 0004's insert/update only checked the caller's role for `institution_id`,
-- never that `guardian_id`/`student_id` actually belong to that same
-- institution. Same shape as finance's fee_assignments_insert (0008)
-- checking its FKs' institution_id.
drop policy guardian_students_insert on public.guardian_students;
create policy guardian_students_insert on public.guardian_students
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and exists (select 1 from public.guardians g where g.id = guardian_students.guardian_id and g.institution_id = guardian_students.institution_id)
    and exists (select 1 from public.students st where st.id = guardian_students.student_id and st.institution_id = guardian_students.institution_id)
  );

drop policy guardian_students_update on public.guardian_students;
create policy guardian_students_update on public.guardian_students
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and exists (select 1 from public.guardians g where g.id = guardian_students.guardian_id and g.institution_id = guardian_students.institution_id)
    and exists (select 1 from public.students st where st.id = guardian_students.student_id and st.institution_id = guardian_students.institution_id)
  );

-- ---------------------------------------------------------------------------
-- class_sections / subject_assignments / enrolments / enrolment_status_history
-- / assignments (0005) — SELECT only.
-- ---------------------------------------------------------------------------

drop policy class_sections_select on public.class_sections;
create policy class_sections_select on public.class_sections
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or id = any((select app.my_student_section_ids()))
  );

drop policy subject_assignments_select on public.subject_assignments;
create policy subject_assignments_select on public.subject_assignments
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or class_section_id = any((select app.my_student_section_ids()))
  );

drop policy enrolments_select on public.enrolments;
create policy enrolments_select on public.enrolments
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or student_id = any((select app.my_student_ids()))
  );

drop policy enrolment_status_history_select on public.enrolment_status_history;
create policy enrolment_status_history_select on public.enrolment_status_history
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or exists (
      select 1 from public.enrolments e
      where e.id = enrolment_status_history.enrolment_id
        and e.student_id = any((select app.my_student_ids()))
    )
  );

drop policy assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or (
      status = 'published'
      and class_section_id = any((select app.my_student_section_ids()))
    )
  );

-- ---------------------------------------------------------------------------
-- marks / results (0009) — SELECT, plus marks INSERT/UPDATE (same teacher
-- branch). Subject-level teacher scope, not app.teaches_section's
-- section-level scope (DBT-19) — uses app.my_taught_section_subjects().
-- ---------------------------------------------------------------------------

drop policy marks_select on public.marks;
create policy marks_select on public.marks
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or exam_paper_id = any((
      select p.id from public.exam_papers p
      where (p.class_section_id, p.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
    ))
  );

drop policy marks_insert on public.marks;
create policy marks_insert on public.marks
  for insert to authenticated
  with check (
    (
      institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
      or exam_paper_id = any((
        select p.id from public.exam_papers p
        where (p.class_section_id, p.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
      ))
    )
    and exists (
      select 1 from public.exam_papers p
      join public.exams e on e.id = p.exam_id
      where p.id = marks.exam_paper_id and p.institution_id = marks.institution_id and e.status in ('marks_entry', 'verification')
    )
    and exists (
      select 1 from public.exam_papers p
      join public.enrolments e on e.class_section_id = p.class_section_id and e.status = 'active'
      where p.id = marks.exam_paper_id and e.student_id = marks.student_id
    )
  );

drop policy marks_update on public.marks;
create policy marks_update on public.marks
  for update to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or exam_paper_id = any((
      select p.id from public.exam_papers p
      where (p.class_section_id, p.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
    ))
  )
  with check (
    (
      institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
      or exam_paper_id = any((
        select p.id from public.exam_papers p
        where (p.class_section_id, p.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
      ))
    )
    and exists (
      select 1 from public.exam_papers p
      join public.exams e on e.id = p.exam_id
      where p.id = marks.exam_paper_id and e.status in ('marks_entry', 'verification')
    )
  );

drop policy results_select on public.results;
create policy results_select on public.results
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.exam_roles())))
    or student_id = any((
      select e.student_id from public.enrolments e
      where e.status = 'active'
        and e.class_section_id = any((select app.my_taught_section_ids()))
    ))
    or student_id = any((select app.my_student_ids()))
  );

-- ---------------------------------------------------------------------------
-- invoices / invoice_lines / payments / receipts / ledger_entries (0008) —
-- SELECT only, no direct writes on any of these five.
-- ---------------------------------------------------------------------------

drop policy invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.finance_roles())))
    or student_id = any((select app.my_student_ids()))
  );

drop policy invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.finance_roles())))
    or exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and i.institution_id = invoice_lines.institution_id
        and i.student_id = any((select app.my_student_ids()))
    )
  );

drop policy payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.finance_roles())))
    or exists (
      select 1 from public.invoices i
      where i.id = payments.invoice_id
        and i.institution_id = payments.institution_id
        and i.student_id = any((select app.my_student_ids()))
    )
  );

drop policy receipts_select on public.receipts;
create policy receipts_select on public.receipts
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.finance_roles())))
    or exists (
      select 1 from public.payments p
      join public.invoices i on i.id = p.invoice_id
      where p.id = receipts.payment_id
        and p.institution_id = receipts.institution_id
        and i.student_id = any((select app.my_student_ids()))
    )
  );

drop policy ledger_entries_select on public.ledger_entries;
create policy ledger_entries_select on public.ledger_entries
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(app.finance_roles()))));

-- ---------------------------------------------------------------------------
-- notifications (0003) — wrap app.current_user_id() so it's cached once
-- per statement instead of re-evaluated per row. audit_events/jobs/
-- delivery_attempts/ai_usage_events found with the same per-row
-- app.has_role(institution_id, ...) shape; rewritten too (cheap, same fix).
-- ---------------------------------------------------------------------------

drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_user_id = (select app.current_user_id()));

drop policy notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_user_id = (select app.current_user_id()))
  with check (recipient_user_id = (select app.current_user_id()));

drop policy audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

drop policy jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select to authenticated
  using (institution_id is not null and institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

-- jobs_update was dropped with no replacement in 0012 (HIGH fix — requeue
-- is public.jobs_claim/jobs_complete-only, service_role); nothing to
-- rewrite here.

drop policy delivery_attempts_select on public.delivery_attempts;
create policy delivery_attempts_select on public.delivery_attempts
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions']))));

drop policy ai_usage_events_select on public.ai_usage_events;
create policy ai_usage_events_select on public.ai_usage_events
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

-- ---------------------------------------------------------------------------
-- Indexes — added where EXPLAIN on the seeded demo tenant showed a missing
-- or insufficiently-leading index for the rewritten policies' predicates.
-- ---------------------------------------------------------------------------

-- attendance_records had (institution_id) and (student_id, session_id) but
-- no plain session_id index; the rewritten teacher branch filters by
-- `session_id in (select ... where class_section_id = any(...))`.
create index attendance_records_session_id_idx on public.attendance_records (session_id);

-- attendance_sessions had (institution_id, date) only; the rewritten
-- select/insert/update predicates filter by class_section_id directly.
create index attendance_sessions_class_section_idx on public.attendance_sessions (class_section_id);

-- guardian_students had a unique partial index on student_id (is_primary)
-- only; app.my_institution_ids-style guardian_id lookups and the
-- guardian_students_select guardian_id branch had no index to use.
create index guardian_students_guardian_id_idx on public.guardian_students (guardian_id);

-- invoices had institution_id, (student_id, term_id) where not cancelled,
-- and (status, due_on); no plain student_id index covering cancelled rows
-- for the guardian/student branch of invoices_select.
create index invoices_student_id_idx on public.invoices (student_id);
