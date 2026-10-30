-- T-0NN — result_remarks: a teacher drafts a one-sentence report-card
-- remark for a student's exam result (optionally AI-assisted via
-- src/app/api/ai/report-remark), edits it, saves it, and it then shows on
-- the guardian/student report card (ReportCard.tsx).
--
-- Intentionally mutable: this is editorial commentary, not a mark or score
-- — rule 5's immutable-history requirement (payments/receipts/results/
-- marks/audit_events) does NOT apply here, unlike `results` itself, which
-- this table only references. A teacher may revise the sentence any number
-- of times; there is no "corrected version" concept to preserve, so a
-- plain UPDATE is correct and no supersede/version trigger is needed.
--
-- Scope mirrors results_select (0020, P-01 initPlan style) exactly, joined
-- through result_id -> results: exam roles (app.exam_roles(), institution-
-- wide) read every remark; the student's taught teacher
-- (app.my_taught_student_ids()) and the student/guardian themself
-- (app.my_student_ids(), which already covers both branches) read their own.
-- Write (INSERT/UPDATE) is narrower — app.exam_write_roles() (owner/
-- principal/exam_controller, admin excluded, lesson #1) or the student's
-- taught teacher. `created_by` is pinned to the caller at INSERT and made
-- immutable at UPDATE via a guard trigger (same shape as 0039's
-- guard_assignment_created_by — a self-referencing old.created_by check
-- can't live in a USING/WITH CHECK clause, 42P17).

create table public.result_remarks (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  result_id uuid not null references public.results (id),
  remark text not null check (char_length(remark) between 1 and 500),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (result_id)
);

create index result_remarks_institution_id_idx on public.result_remarks (institution_id);

create trigger set_updated_at
before update on public.result_remarks
for each row execute function app.set_updated_at();

alter table public.result_remarks enable row level security;

create policy result_remarks_select on public.result_remarks
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.exam_roles())))
    or exists (
      select 1 from public.results r
      where r.id = result_remarks.result_id
        and r.institution_id = result_remarks.institution_id
        and (
          r.student_id = any((select app.my_taught_student_ids()))
          or r.student_id = any((select app.my_student_ids()))
        )
    )
  );

create policy result_remarks_insert on public.result_remarks
  for insert to authenticated
  with check (
    created_by = app.current_user_id()
    and exists (
      select 1 from public.results r
      where r.id = result_remarks.result_id and r.institution_id = result_remarks.institution_id
    )
    and (
      app.has_role(result_remarks.institution_id, app.exam_write_roles())
      or exists (
        select 1 from public.results r
        where r.id = result_remarks.result_id
          and r.institution_id = result_remarks.institution_id
          and r.student_id = any((select app.my_taught_student_ids()))
      )
    )
  );

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
      where r.id = result_remarks.result_id and r.institution_id = result_remarks.institution_id
    )
    and (
      app.has_role(result_remarks.institution_id, app.exam_write_roles())
      or exists (
        select 1 from public.results r
        where r.id = result_remarks.result_id
          and r.institution_id = result_remarks.institution_id
          and r.student_id = any((select app.my_taught_student_ids()))
      )
    )
  );

-- No DELETE policy (packet spec) — a remark is removed only by overwriting
-- its text via UPDATE, never by row deletion.

create function app.guard_result_remark_created_by()
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

  if new.created_by is distinct from old.created_by then
    raise exception 'code:forbidden' using detail = 'result_remarks.created_by never changes';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_result_remark_created_by() from public;

create trigger guard_result_remark_created_by
before update on public.result_remarks
for each row execute function app.guard_result_remark_created_by();
