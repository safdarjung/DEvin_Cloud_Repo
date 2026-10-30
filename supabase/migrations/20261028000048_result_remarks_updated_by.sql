-- T-0NN fix round 1 (independent security review, LOW-1): result_remarks'
-- INSERT/UPDATE EXISTS joins (0047) didn't require the referenced result to
-- be current (`superseded_by is null`), so a remark could be written/edited
-- against an already-superseded result version. That write is harmless on
-- its own but then orphans invisibly: `getResultRemark` looks up by
-- `result_id`, and a recheck decision creates a NEW `results` row (a new
-- `version_no`), so the old row's remark can never be read again through
-- the current-version query path — "vanishes after a recheck". Require the
-- result to be current at write time (WITH CHECK only, matching this
-- codebase's precedent of putting integrity/FK checks there rather than
-- duplicating them into USING, e.g. 0026/0039's assignments policies).
--
-- MED-3 (same review): any teacher of the student could silently overwrite
-- another teacher's saved remark with no attribution change and no audit
-- trail (`created_by` is correctly pinned/immutable, 0047, but nothing
-- records *who last edited* or *when*). Chose calling `audit()` on every
-- save in `saveResultRemark` (src/modules/exams/actions.ts) over adding an
-- `updated_by` column — smaller change, no RLS/schema touch needed, and
-- `audit_events` already gives every write an actor + timestamp via
-- `record_audit_event` without ever storing the remark text itself (no
-- free-form user content in audit before/after/metadata). This migration
-- carries only the LOW-1 RLS fix; no `updated_by` column is added.

drop policy result_remarks_insert on public.result_remarks;
create policy result_remarks_insert on public.result_remarks
  for insert to authenticated
  with check (
    created_by = app.current_user_id()
    and exists (
      select 1 from public.results r
      where r.id = result_remarks.result_id
        and r.institution_id = result_remarks.institution_id
        and r.superseded_by is null
    )
    and (
      app.has_role(result_remarks.institution_id, app.exam_write_roles())
      or exists (
        select 1 from public.results r
        where r.id = result_remarks.result_id
          and r.institution_id = result_remarks.institution_id
          and r.superseded_by is null
          and r.student_id = any((select app.my_taught_student_ids()))
      )
    )
  );

drop policy result_remarks_update on public.result_remarks;
create policy result_remarks_update on public.result_remarks
  for update to authenticated
  using (
    app.has_role(result_remarks.institution_id, app.exam_write_roles())
    or exists (
      select 1 from public.results r
      where r.id = result_remarks.result_id
        and r.institution_id = result_remarks.institution_id
        and r.student_id = any((select app.my_taught_student_ids()))
    )
  )
  with check (
    exists (
      select 1 from public.results r
      where r.id = result_remarks.result_id
        and r.institution_id = result_remarks.institution_id
        and r.superseded_by is null
    )
    and (
      app.has_role(result_remarks.institution_id, app.exam_write_roles())
      or exists (
        select 1 from public.results r
        where r.id = result_remarks.result_id
          and r.institution_id = result_remarks.institution_id
          and r.superseded_by is null
          and r.student_id = any((select app.my_taught_student_ids()))
      )
    )
  );
