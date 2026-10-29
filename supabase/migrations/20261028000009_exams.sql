-- T-017: exam tables, versioning triggers, RLS + app.exam_verification,
-- app.publish_exam_results, app.apply_recheck_decision (05 §2.7, §4.1 exams
-- block, §5, §6; 06 §W7, §W8; 07 §2.2 exam.* rows, §4).
--
-- Snapshot shape (owned here, consumed by T-019's ReportCard):
--   results.snapshot = {
--     "subjects": [ { "exam_paper_id", "subject_id", "marks_obtained"?,
--       "max_marks", "is_absent", "passed", "grade"? } , ... ],
--     "attendancePercentage": number
--   }
--
-- Role-helper vs 07 §2.2 matrix (lesson #1 — app.exam_roles() from 0001 is
-- owner/principal/admin/exam_controller, which is correct for exam.result.
-- read but WIDER than exam.manage / exam.result.publish / exam.recheck.
-- review+decide, all three of which are owner/principal/exam_controller
-- ONLY — admin excluded. A new app.exam_write_roles() below is that
-- narrower set, used for every write-side check in this file (exams/
-- exam_papers writes, publish, recheck decide). exam.marks.enter is the
-- same narrower set plus teacher scoped by subject — also admin-excluded —
-- so marks SELECT/INSERT below use exam_write_roles() + teacher, not
-- exam_roles(). app.exam_roles() itself is kept for SELECT policies where
-- the matrix explicitly includes admin (results, recheck_decisions).
--
-- marks/results follow 0010's page_versions precedent for a versioned-
-- immutable table: created_at only, no updated_at column, no
-- set_updated_at trigger (nothing field other than the one guarded
-- supersede column is ever updated). recheck_decisions follows 0007's
-- application_decisions precedent: created_at only + block_mutation
-- (append-only, no versioning).
--
-- Revision-audit triggers (marks/results, 05 §6) are AFTER INSERT only, not
-- AFTER UPDATE — "insert audit_events with after image" (packet wording).
-- This is deliberate, not an oversight: apply_recheck_decision's approve
-- path inserts exactly one new marks row and one new results row (the
-- supersede is an UPDATE of the OLD row, carrying no new information the
-- INSERT didn't already audit), so C-42's "two audit rows" comes entirely
-- from these two triggers — apply_recheck_decision adds no further explicit
-- app.audit call on the approve path. The reject path touches no marks/
-- results row, so it keeps its own explicit app.audit call (otherwise
-- rejecting would leave no audit trail at all). publish_exam_results keeps
-- its own explicit app.audit('exam.published') summary call in addition to
-- the per-result trigger rows below — intentional dual-grain history (one
-- audit row per published result, one summary row with the count), not a
-- duplicate of the same fact.

-- ---------------------------------------------------------------------------
-- Tables (05 §2.7). Every tenant table carries institution_id directly
-- (rule 1) even where the data dictionary's "essential columns" list omits
-- it, same reasoning as 0010's page_versions.
-- ---------------------------------------------------------------------------

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  academic_year_id uuid not null references public.academic_years (id),
  term_id uuid not null references public.terms (id),
  name text not null,
  type text not null check (type in ('unit_test', 'half_yearly', 'annual')),
  status text not null default 'draft' check (status in ('draft', 'marks_entry', 'verification', 'published')),
  grading_scale_key text not null default 'default',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_id, name)
);

create index exams_institution_id_idx on public.exams (institution_id);
create index exams_status_idx on public.exams (status);

create trigger set_updated_at
before update on public.exams
for each row execute function app.set_updated_at();

create table public.exam_papers (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  exam_id uuid not null references public.exams (id),
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  max_marks numeric(6, 2) not null check (max_marks > 0),
  pass_marks numeric(6, 2) not null check (pass_marks >= 0),
  held_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, class_section_id, subject_id),
  check (pass_marks <= max_marks)
);

create index exam_papers_institution_id_idx on public.exam_papers (institution_id);
create index exam_papers_exam_id_idx on public.exam_papers (exam_id);

create trigger set_updated_at
before update on public.exam_papers
for each row execute function app.set_updated_at();

-- marks: versioned, never updated except superseded_by (once). No
-- updated_at — see file header.
create table public.marks (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  exam_paper_id uuid not null references public.exam_papers (id),
  student_id uuid not null references public.students (id),
  marks_obtained numeric(6, 2),
  is_absent boolean not null default false,
  version_no int not null default 1,
  -- deferrable initially deferred: app.apply_recheck_decision inserts the
  -- new row first (so app.marks_guard's cross-row validation below has a
  -- real row to check), then updates the OLD row to point at it; the two
  -- statements momentarily leave both rows with superseded_by null, which
  -- app.marks_one_current_check (a deferred constraint trigger, not a
  -- plain unique index) only checks at commit. The FK stays deferred too
  -- so an unrelated future ordering never trips it immediately.
  superseded_by uuid references public.marks (id) deferrable initially deferred,
  source text not null default 'entry' check (source in ('entry', 'recheck')),
  entered_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (exam_paper_id, student_id, version_no),
  check (is_absent or marks_obtained is not null)
);

-- "One current row" is enforced by a deferrable constraint trigger
-- (app.marks_one_current_check below), not a plain unique index. A unique
-- index checks immediately per statement, including app.demo_reset's (0001)
-- generic "null out every self-referencing FK column, then delete" sweep,
-- which — for one single UPDATE — un-supersedes every old row of the
-- institution at once, momentarily reintroducing exactly the "two current
-- rows for the same key" shape this invariant forbids, before the rows are
-- deleted later in that same transaction. A deferred trigger checks once at
-- commit, after demo_reset's deletes have already removed the duplicates.
create index marks_current_idx on public.marks (exam_paper_id, student_id) where superseded_by is null;
create index marks_institution_id_idx on public.marks (institution_id);
create index marks_student_id_idx on public.marks (student_id);

-- results: immutable published snapshot, versioned the same way as marks.
create table public.results (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  exam_id uuid not null references public.exams (id),
  student_id uuid not null references public.students (id),
  snapshot jsonb not null,
  total numeric(8, 2) not null,
  max_total numeric(8, 2) not null,
  percentage numeric(5, 2) not null,
  grade text not null,
  version_no int not null default 1,
  -- deferrable initially deferred — same reason as marks.superseded_by above.
  superseded_by uuid references public.results (id) deferrable initially deferred,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (exam_id, student_id, version_no)
);

-- Same reasoning as marks_current_idx above — plain index, uniqueness
-- enforced by the deferred app.results_one_current_check trigger.
create index results_current_idx on public.results (exam_id, student_id) where superseded_by is null;
create index results_institution_id_idx on public.results (institution_id);
create index results_student_id_idx on public.results (student_id);

create table public.recheck_requests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  result_id uuid not null references public.results (id),
  exam_paper_id uuid not null references public.exam_papers (id),
  requested_by uuid references public.profiles (id),
  reason text not null,
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'approved', 'rejected', 'applied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index recheck_requests_one_open_idx on public.recheck_requests (result_id, exam_paper_id) where status in ('submitted', 'under_review');
create index recheck_requests_institution_id_idx on public.recheck_requests (institution_id);

create trigger set_updated_at
before update on public.recheck_requests
for each row execute function app.set_updated_at();

-- recheck_decisions: append-only (05 §6), same shape as 0007's application_decisions.
create table public.recheck_decisions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  request_id uuid not null references public.recheck_requests (id),
  decided_by uuid references public.profiles (id),
  decision text not null check (decision in ('approve', 'reject')),
  new_marks numeric(6, 2),
  note text,
  applied_marks_id uuid references public.marks (id),
  applied_result_id uuid references public.results (id),
  created_at timestamptz not null default now()
);

create index recheck_decisions_institution_id_idx on public.recheck_decisions (institution_id);
create index recheck_decisions_request_id_idx on public.recheck_decisions (request_id);

create trigger block_mutation
before update or delete on public.recheck_decisions
for each row execute function app.block_mutation();

-- answer_sheets: P1 scanned scripts, operational (re-uploadable).
create table public.answer_sheets (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  exam_paper_id uuid not null references public.exam_papers (id),
  student_id uuid not null references public.students (id),
  storage_path text not null,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_paper_id, student_id)
);

create index answer_sheets_institution_id_idx on public.answer_sheets (institution_id);

create trigger set_updated_at
before update on public.answer_sheets
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- app.exam_write_roles() — narrower than app.exam_roles() (0001), matching
-- 07 §2.2 exam.manage / exam.result.publish / exam.recheck.review+decide /
-- the non-teacher part of exam.marks.enter: owner/principal/exam_controller
-- only, admin excluded (lesson #1).
-- ---------------------------------------------------------------------------

create function app.exam_write_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['owner', 'principal', 'exam_controller'];
$$;

revoke execute on function app.exam_write_roles() from public;
grant execute on function app.exam_write_roles() to authenticated;

-- ---------------------------------------------------------------------------
-- app.marks_guard() — BEFORE INSERT/UPDATE/DELETE on marks (05 §2.7, §6).
-- INSERT: 0 <= marks_obtained <= exam_papers.max_marks, unless is_absent.
-- UPDATE: only superseded_by may change, only from null, only once, and only
-- to the paper's own current, later row for the SAME student+institution.
-- DELETE: blocked outside app.demo_reset.
--
-- Fix round 1 (CRITICAL, security review): neither this trigger nor the RLS
-- policies checked the exam's status, so a bare subject teacher could
-- insert a new "entry" version and supersede the old one on an ALREADY
-- PUBLISHED exam — no recheck, no approval, and the audit trail read as an
-- ordinary entry. Also, superseded_by accepted ANY existing marks row,
-- including another student's. Both are fixed here:
--   - marks may only be entered/superseded while the paper's exam is
--     marks_entry or verification, UNLESS app.allow_marks_revision is set
--     for the transaction (app.apply_recheck_decision's own post-publish
--     correction) or the caller is a genuinely trusted non-RLS connection
--     (see fix round 2 below — not "no JWT context", which also describes
--     anon).
--   - on supersede, the target row (new.superseded_by) must exist, share
--     this row's exam_paper_id/student_id/institution_id, be itself
--     current (its own superseded_by is null) and be newer (created_at
--     later) than the row being superseded.
--
-- Fix round 2 (security review): round 1's bypass condition was
-- `app.current_user_id() is null`, i.e. "no JWT claims" — but `anon` also
-- has a null `auth.uid()`. The guard's only protection against `anon` was
-- the absence of an RLS policy granting it marks access in the first
-- place; the GUARD itself would have waved an `anon` write straight
-- through. Replaced with two checks that are each unambiguous about WHO is
-- connecting, not just "is there a user id":
--   - the PostgREST JWT's own `role` claim is `service_role` (the seed
--     and the job runner both call through PostgREST with the service
--     key — `request.jwt.claims ->> 'role'`, not `app.current_user_id()`,
--     which only reads `auth.uid()` and says nothing about which Postgres
--     role is attached);
--   - `session_user = 'postgres'` (a direct superuser connection — e.g. a
--     script using `SUPABASE_DB_URL` directly, no PostgREST in the path
--     at all, so there is no `request.jwt.claims` to read). `current_user`
--     is NOT used here: this function is `security definer`, so
--     `current_user` is always the function's owner (`postgres`)
--     regardless of who is actually connected — exactly what made round
--     1's reasoning ("no JWT context means trusted") wrong for `anon`,
--     which DOES have a JWT (role claim `anon`, just no `sub`/`uid`).
-- security definer so the nested app.current_user_id() call (still used
-- elsewhere in this function) succeeds for every firing role regardless of
-- grants (0011's lesson, same shape as app.membership_changed) — it also
-- means the exam-status lookup below always sees the true row regardless
-- of the firing role's own RLS. `results_guard` below was checked for the
-- same pattern — it never calls app.current_user_id() or has any bypass,
-- so it needed no change.
-- ---------------------------------------------------------------------------

create function app.marks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_marks numeric(6, 2);
  v_exam_status text;
  v_bypass boolean;
  v_target public.marks;
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'code:invalid_state' using detail = 'marks rows are never deleted; supersede instead';
  end if;

  select e.status into v_exam_status
  from public.exam_papers p
  join public.exams e on e.id = p.exam_id
  where p.id = coalesce(new.exam_paper_id, old.exam_paper_id);

  v_bypass := (
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
    or current_setting('app.allow_marks_revision', true) = 'on'
  );

  if not v_bypass and v_exam_status not in ('marks_entry', 'verification') then
    raise exception 'code:invalid_state' using detail = format('marks cannot be entered or revised while the exam is %s', v_exam_status);
  end if;

  if tg_op = 'UPDATE' then
    if old.superseded_by is not null
      or new.exam_paper_id is distinct from old.exam_paper_id
      or new.student_id is distinct from old.student_id
      or new.marks_obtained is distinct from old.marks_obtained
      or new.is_absent is distinct from old.is_absent
      or new.version_no is distinct from old.version_no
      or new.source is distinct from old.source
      or new.entered_by is distinct from old.entered_by
      or new.created_at is distinct from old.created_at
      or new.superseded_by is null
    then
      raise exception 'code:invalid_state' using detail = 'marks rows are immutable; only superseded_by may be set once';
    end if;

    select * into v_target from public.marks where id = new.superseded_by;

    if v_target.id is null
      or v_target.exam_paper_id is distinct from old.exam_paper_id
      or v_target.student_id is distinct from old.student_id
      or v_target.institution_id is distinct from old.institution_id
      or v_target.superseded_by is not null
      or v_target.created_at <= old.created_at
    then
      raise exception 'code:invalid_state' using detail = 'superseded_by must reference the current, later marks row for the same paper, student and institution';
    end if;

    return new;
  end if;

  -- INSERT
  if not new.is_absent then
    select max_marks into v_max_marks from public.exam_papers where id = new.exam_paper_id;
    if v_max_marks is null then
      raise exception 'code:not_found' using detail = 'exam paper not found';
    end if;
    if new.marks_obtained is null or new.marks_obtained < 0 or new.marks_obtained > v_max_marks then
      raise exception 'code:validation_failed' using detail = format('marks_obtained must be between 0 and %s', v_max_marks);
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function app.marks_guard() from public;

create trigger marks_guard
before insert or update or delete on public.marks
for each row execute function app.marks_guard();

-- ---------------------------------------------------------------------------
-- app.results_guard() — same superseded_by-only rule as marks_guard, for
-- results. No INSERT-time check (results are only ever built by the two
-- trusted security-definer functions below).
-- ---------------------------------------------------------------------------

create function app.results_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'code:invalid_state' using detail = 'results rows are never deleted; supersede instead';
  end if;

  if old.superseded_by is not null
    or new.exam_id is distinct from old.exam_id
    or new.student_id is distinct from old.student_id
    or new.snapshot is distinct from old.snapshot
    or new.total is distinct from old.total
    or new.max_total is distinct from old.max_total
    or new.percentage is distinct from old.percentage
    or new.grade is distinct from old.grade
    or new.version_no is distinct from old.version_no
    or new.published_at is distinct from old.published_at
    or new.created_at is distinct from old.created_at
    or new.superseded_by is null
  then
    raise exception 'code:invalid_state' using detail = 'results rows are immutable; only superseded_by may be set once';
  end if;

  return new;
end;
$$;

create trigger results_guard
before update or delete on public.results
for each row execute function app.results_guard();

-- ---------------------------------------------------------------------------
-- "One current row per (exam_paper_id, student_id)" / "...per (exam_id,
-- student_id)" — deferrable constraint triggers, not a unique index (see
-- marks_current_idx / results_current_idx above for why). Checked once at
-- commit, so app.apply_recheck_decision's update-old-then-insert-new order
-- (needed for the deferred self-referencing FK, same file) never trips it
-- mid-transaction, and app.demo_reset's (0001) generic FK-nulling sweep
-- never trips it either — its matching deletes land before commit.
-- ---------------------------------------------------------------------------

create function app.marks_one_current_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from public.marks
    where exam_paper_id = new.exam_paper_id and student_id = new.student_id and superseded_by is null
  ) > 1 then
    raise exception 'code:conflict' using detail = 'more than one current marks row for this (exam_paper_id, student_id)';
  end if;
  return null;
end;
$$;

create constraint trigger marks_one_current
after insert or update on public.marks
deferrable initially deferred
for each row execute function app.marks_one_current_check();

create function app.results_one_current_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from public.results
    where exam_id = new.exam_id and student_id = new.student_id and superseded_by is null
  ) > 1 then
    raise exception 'code:conflict' using detail = 'more than one current results row for this (exam_id, student_id)';
  end if;
  return null;
end;
$$;

create constraint trigger results_one_current
after insert or update on public.results
deferrable initially deferred
for each row execute function app.results_one_current_check();

-- ---------------------------------------------------------------------------
-- Revision-audit triggers (05 §6) — AFTER INSERT only, see file header.
-- security definer so the nested app.audit() call succeeds for every firing
-- role regardless of grants (0011's lesson, same shape as
-- app.membership_changed).
-- ---------------------------------------------------------------------------

create function app.marks_revision_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.audit(
    new.institution_id,
    coalesce(app.current_user_id(), new.entered_by),
    case when new.source = 'recheck' then 'exam.recheck.applied' else 'exam.marks.entered' end,
    'marks',
    new.id,
    null,
    jsonb_build_object(
      'exam_paper_id', new.exam_paper_id, 'student_id', new.student_id, 'version_no', new.version_no,
      'marks_obtained', new.marks_obtained, 'is_absent', new.is_absent, 'source', new.source
    ),
    null
  );
  return new;
end;
$$;

revoke execute on function app.marks_revision_audit() from public;

create trigger marks_revision_audit
after insert on public.marks
for each row execute function app.marks_revision_audit();

create function app.results_revision_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.audit(
    new.institution_id,
    app.current_user_id(),
    case when new.version_no = 1 then 'exam.published' else 'exam.recheck.applied' end,
    'results',
    new.id,
    null,
    jsonb_build_object(
      'exam_id', new.exam_id, 'student_id', new.student_id, 'version_no', new.version_no,
      'total', new.total, 'max_total', new.max_total, 'percentage', new.percentage, 'grade', new.grade
    ),
    null
  );
  return new;
end;
$$;

revoke execute on function app.results_revision_audit() from public;

create trigger results_revision_audit
after insert on public.results
for each row execute function app.results_revision_audit();

-- ---------------------------------------------------------------------------
-- RLS (05 §5, §6; 07 §2.2).
-- ---------------------------------------------------------------------------

alter table public.exams enable row level security;
alter table public.exam_papers enable row level security;
alter table public.marks enable row level security;
alter table public.results enable row level security;
alter table public.recheck_requests enable row level security;
alter table public.recheck_decisions enable row level security;
alter table public.answer_sheets enable row level security;

-- exams/exam_papers: class S. SELECT is staff-wide (app.staff_roles(), same
-- as grades/subjects reference data); writes are exam.manage, which is
-- narrower than app.staff_roles() (own/principal/exam_controller only —
-- lesson #1), not every staff role.
create policy exams_select on public.exams
  for select to authenticated
  using (app.has_role(institution_id, app.staff_roles()));

create policy exams_insert on public.exams
  for insert to authenticated
  with check (
    app.has_role(institution_id, app.exam_write_roles())
    and exists (select 1 from public.academic_years y where y.id = exams.academic_year_id and y.institution_id = exams.institution_id)
    and exists (select 1 from public.terms t where t.id = exams.term_id and t.institution_id = exams.institution_id)
  );

create policy exams_update on public.exams
  for update to authenticated
  using (app.has_role(institution_id, app.exam_write_roles()))
  with check (
    app.has_role(institution_id, app.exam_write_roles())
    and exists (select 1 from public.academic_years y where y.id = exams.academic_year_id and y.institution_id = exams.institution_id)
    and exists (select 1 from public.terms t where t.id = exams.term_id and t.institution_id = exams.institution_id)
  );

create policy exam_papers_select on public.exam_papers
  for select to authenticated
  using (app.has_role(institution_id, app.staff_roles()));

create policy exam_papers_insert on public.exam_papers
  for insert to authenticated
  with check (
    app.has_role(institution_id, app.exam_write_roles())
    and exists (select 1 from public.exams e where e.id = exam_papers.exam_id and e.institution_id = exam_papers.institution_id)
    and exists (select 1 from public.class_sections cs where cs.id = exam_papers.class_section_id and cs.institution_id = exam_papers.institution_id)
    and exists (select 1 from public.subjects s where s.id = exam_papers.subject_id and s.institution_id = exam_papers.institution_id)
  );

create policy exam_papers_update on public.exam_papers
  for update to authenticated
  using (app.has_role(institution_id, app.exam_write_roles()))
  with check (
    app.has_role(institution_id, app.exam_write_roles())
    and exists (select 1 from public.exams e where e.id = exam_papers.exam_id and e.institution_id = exam_papers.institution_id)
    and exists (select 1 from public.class_sections cs where cs.id = exam_papers.class_section_id and cs.institution_id = exam_papers.institution_id)
    and exists (select 1 from public.subjects s where s.id = exam_papers.subject_id and s.institution_id = exam_papers.institution_id)
  );

-- marks: exam.marks.enter (07 §2.2) = own/principal/exam_controller + the
-- teacher assigned to that paper's section AND subject (DBT-19 lesson —
-- subject-level, not app.teaches_section's section-level class-teacher-or-
-- any-subject check). No admin, no guardian/student (05 §3: confidential at
-- all times, no guardian policy pre-publication). UPDATE is added here
-- (not named explicitly in the packet's RLS bullet, which only lists SELECT/
-- INSERT) because marks versioning needs a supersede UPDATE and no
-- security-definer function in this packet's scope performs it; the
-- immutability is still enforced by app.marks_guard, not by this policy.
-- Fix round 1 (CRITICAL): INSERT/UPDATE additionally require the paper's
-- exam to be marks_entry or verification — a direct PostgREST write (not
-- app.apply_recheck_decision, which bypasses RLS as a security-definer
-- function) can never touch marks on a published exam. Defense in depth
-- alongside app.marks_guard's own, identical check.
create policy marks_select on public.marks
  for select to authenticated
  using (
    app.has_role(institution_id, app.exam_write_roles())
    or exists (
      select 1 from public.exam_papers p
      join public.subject_assignments sa on sa.class_section_id = p.class_section_id and sa.subject_id = p.subject_id
      where p.id = marks.exam_paper_id and sa.teacher_id = app.staff_id(marks.institution_id)
    )
  );

create policy marks_insert on public.marks
  for insert to authenticated
  with check (
    (
      app.has_role(institution_id, app.exam_write_roles())
      or exists (
        select 1 from public.exam_papers p
        join public.subject_assignments sa on sa.class_section_id = p.class_section_id and sa.subject_id = p.subject_id
        where p.id = marks.exam_paper_id and sa.teacher_id = app.staff_id(marks.institution_id)
      )
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

create policy marks_update on public.marks
  for update to authenticated
  using (
    app.has_role(institution_id, app.exam_write_roles())
    or exists (
      select 1 from public.exam_papers p
      join public.subject_assignments sa on sa.class_section_id = p.class_section_id and sa.subject_id = p.subject_id
      where p.id = marks.exam_paper_id and sa.teacher_id = app.staff_id(marks.institution_id)
    )
  )
  with check (
    (
      app.has_role(institution_id, app.exam_write_roles())
      or exists (
        select 1 from public.exam_papers p
        join public.subject_assignments sa on sa.class_section_id = p.class_section_id and sa.subject_id = p.subject_id
        where p.id = marks.exam_paper_id and sa.teacher_id = app.staff_id(marks.institution_id)
      )
    )
    and exists (
      select 1 from public.exam_papers p
      join public.exams e on e.id = p.exam_id
      where p.id = marks.exam_paper_id and e.status in ('marks_entry', 'verification')
    )
  );

-- results: exam.result.read (07 §2.2) = own/principal/admin/exam_controller
-- (= app.exam_roles() exactly) + teacher scoped to the student's current
-- section + guardian/student own-scope. No write policy — only
-- app.publish_exam_results / app.apply_recheck_decision write this table
-- (security definer, bypass RLS as owner), same shape as finance's
-- money-movement tables.
create policy results_select on public.results
  for select to authenticated
  using (
    app.has_role(institution_id, app.exam_roles())
    or exists (
      select 1 from public.enrolments e
      where e.student_id = results.student_id and e.status = 'active' and e.institution_id = results.institution_id
        and app.teaches_section(results.institution_id, e.class_section_id)
    )
    or student_id in (select app.guardian_student_ids(results.institution_id))
    or student_id = app.own_student_id(results.institution_id)
  );

-- recheck_requests: own rows for guardian/student (via the result they
-- requested against) plus exam_write_roles() (controller filing on behalf,
-- 06 §W8 failure/retry note). requested_by is pinned to the caller in
-- `with check` so no one can file a request attributed to someone else.
create policy recheck_requests_select on public.recheck_requests
  for select to authenticated
  using (
    app.has_role(institution_id, app.exam_write_roles())
    or exists (
      select 1 from public.results r
      where r.id = recheck_requests.result_id
        and (
          r.student_id in (select app.guardian_student_ids(recheck_requests.institution_id))
          or r.student_id = app.own_student_id(recheck_requests.institution_id)
        )
    )
  );

create policy recheck_requests_insert on public.recheck_requests
  for insert to authenticated
  with check (
    requested_by = app.current_user_id()
    and exists (select 1 from public.exam_papers p where p.id = recheck_requests.exam_paper_id and p.institution_id = recheck_requests.institution_id)
    and exists (
      select 1 from public.results r
      where r.id = recheck_requests.result_id and r.institution_id = recheck_requests.institution_id
        and (
          app.has_role(recheck_requests.institution_id, app.exam_write_roles())
          or r.student_id in (select app.guardian_student_ids(recheck_requests.institution_id))
          or r.student_id = app.own_student_id(recheck_requests.institution_id)
        )
    )
  );

-- recheck_decisions: SELECT only (app.exam_roles() — admin included, 05 §5
-- "C" class default read). Writes are apply_recheck_decision-only.
create policy recheck_decisions_select on public.recheck_decisions
  for select to authenticated
  using (app.has_role(institution_id, app.exam_roles()));

-- answer_sheets: exam roles only (packet), both read and write.
create policy answer_sheets_select on public.answer_sheets
  for select to authenticated
  using (app.has_role(institution_id, app.exam_roles()));

create policy answer_sheets_insert on public.answer_sheets
  for insert to authenticated
  with check (
    app.has_role(institution_id, app.exam_roles())
    and exists (select 1 from public.exam_papers p where p.id = answer_sheets.exam_paper_id and p.institution_id = answer_sheets.institution_id)
  );

create policy answer_sheets_update on public.answer_sheets
  for update to authenticated
  using (app.has_role(institution_id, app.exam_roles()))
  with check (
    app.has_role(institution_id, app.exam_roles())
    and exists (select 1 from public.exam_papers p where p.id = answer_sheets.exam_paper_id and p.institution_id = answer_sheets.institution_id)
  );

-- ---------------------------------------------------------------------------
-- app.term_attendance_percentage — helper for the results snapshot (06 §W7:
-- "term attendance %"), not separately named in the packet's function list
-- but required to build it. Institution-local weighting from
-- settings.attendance.statuses (05 §4.1: counts_present, in_denominator),
-- over the student's enrolled section for the exam's term's date range.
-- Returns 0 when there is no enrolment or no attendance rows (packet's own
-- stated assumption).
-- ---------------------------------------------------------------------------

create function app.term_attendance_percentage(p_institution_id uuid, p_student_id uuid, p_term_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term public.terms;
  v_section_id uuid;
  v_present numeric;
  v_denominator numeric;
begin
  -- Fix round 1 (LOW): every lookup below is now explicitly scoped to
  -- p_institution_id (defense in depth) rather than trusting the caller's
  -- p_student_id/p_term_id to already belong to it.
  select * into v_term from public.terms where id = p_term_id and institution_id = p_institution_id;
  if v_term.id is null then
    return 0;
  end if;

  select e.class_section_id into v_section_id
  from public.enrolments e
  where e.student_id = p_student_id and e.institution_id = p_institution_id
    and e.academic_year_id = v_term.academic_year_id and e.status = 'active'
  limit 1;

  if v_section_id is null then
    return 0;
  end if;

  select
    coalesce(sum(case when coalesce((codes.w ->> 'in_denominator')::boolean, false) then coalesce((codes.w ->> 'counts_present')::numeric, 0) else 0 end), 0),
    coalesce(sum(case when coalesce((codes.w ->> 'in_denominator')::boolean, false) then 1 else 0 end), 0)
  into v_present, v_denominator
  from public.attendance_records ar
  join public.attendance_sessions s on s.id = ar.session_id
  join public.institutions i on i.id = p_institution_id
  left join lateral (
    select elem as w from jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) elem
    where elem ->> 'code' = ar.status
    limit 1
  ) codes on true
  where ar.student_id = p_student_id
    and ar.institution_id = p_institution_id
    and s.class_section_id = v_section_id
    and s.date between v_term.starts_on and v_term.ends_on;

  if v_denominator is null or v_denominator = 0 then
    return 0;
  end if;

  return round(v_present / v_denominator * 100, 2);
end;
$$;

revoke execute on function app.term_attendance_percentage(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.exam_verification(exam_id) — 06 §W7, read-only. Not independently
-- PostgREST-exposed (no public.* wrapper): used internally by
-- app.publish_exam_results; a UI verification panel calling this directly
-- is a future task's addition, not this packet's.
-- ---------------------------------------------------------------------------

create function app.exam_verification(p_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exam public.exams;
  v_missing jsonb;
  v_out_of_range jsonb;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if v_exam.id is null then
    raise exception 'code:not_found' using detail = 'exam not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'exam_paper_id', p.id, 'class_section_id', p.class_section_id, 'subject_id', p.subject_id, 'student_id', e.student_id
  )), '[]'::jsonb)
  into v_missing
  from public.exam_papers p
  join public.enrolments e on e.class_section_id = p.class_section_id and e.status = 'active'
  where p.exam_id = p_exam_id
    and not exists (
      select 1 from public.marks m where m.exam_paper_id = p.id and m.student_id = e.student_id and m.superseded_by is null
    );

  -- Defensive: app.marks_guard already blocks an out-of-range INSERT, so
  -- this should always be empty; kept because the packet names it as part
  -- of this function's returned shape.
  select coalesce(jsonb_agg(jsonb_build_object(
    'exam_paper_id', m.exam_paper_id, 'student_id', m.student_id, 'marks_obtained', m.marks_obtained, 'max_marks', p.max_marks
  )), '[]'::jsonb)
  into v_out_of_range
  from public.marks m
  join public.exam_papers p on p.id = m.exam_paper_id
  where p.exam_id = p_exam_id and m.superseded_by is null and m.marks_obtained is not null
    and (m.marks_obtained < 0 or m.marks_obtained > p.max_marks);

  return jsonb_build_object(
    'missing', v_missing,
    'outOfRange', v_out_of_range,
    'summary', jsonb_build_object(
      'missingCount', jsonb_array_length(v_missing),
      'outOfRangeCount', jsonb_array_length(v_out_of_range),
      'clean', jsonb_array_length(v_missing) = 0 and jsonb_array_length(v_out_of_range) = 0
    )
  );
end;
$$;

revoke execute on function app.exam_verification(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.publish_exam_results(exam_id) — 06 §W7, §4. Role check lives inside
-- app.* itself (not a public.*-only check) — same shape as 0010's
-- app.publish_page: this function is meant for direct `authenticated` RPC
-- use, with no internal same-transaction caller that would be wrongly
-- re-checked (unlike 0008's finance functions).
-- ---------------------------------------------------------------------------

create function app.publish_exam_results(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exams;
  v_verification jsonb;
  v_result_count int := 0;
  v_student record;
  v_paper record;
  v_snapshot_subjects jsonb;
  v_total numeric(8, 2);
  v_max_total numeric(8, 2);
  v_percentage numeric(5, 2);
  v_grade text;
  v_attendance_pct numeric;
  v_result_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_exam from public.exams where id = p_exam_id for update;
  if v_exam.id is null then
    raise exception 'code:not_found' using detail = 'exam not found';
  end if;

  if not app.has_role(v_exam.institution_id, app.exam_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.result.publish for this institution';
  end if;

  if v_exam.status <> 'verification' then
    raise exception 'code:invalid_state' using detail = format('exam must be in verification to publish; current status is %s', v_exam.status);
  end if;

  v_verification := app.exam_verification(p_exam_id);
  if not (v_verification -> 'summary' ->> 'clean')::boolean then
    raise exception 'code:invalid_state' using detail = format('exam has unresolved verification issues: %s', v_verification -> 'summary');
  end if;

  for v_student in
    select distinct e.student_id
    from public.exam_papers p
    join public.enrolments e on e.class_section_id = p.class_section_id and e.status = 'active'
    where p.exam_id = p_exam_id
  loop
    v_snapshot_subjects := '[]'::jsonb;
    v_total := 0;
    v_max_total := 0;

    for v_paper in
      select p.id as exam_paper_id, p.subject_id, p.max_marks, p.pass_marks, m.marks_obtained, m.is_absent
      from public.exam_papers p
      join public.enrolments e on e.class_section_id = p.class_section_id and e.status = 'active'
      left join public.marks m on m.exam_paper_id = p.id and m.student_id = e.student_id and m.superseded_by is null
      where p.exam_id = p_exam_id and e.student_id = v_student.student_id
    loop
      v_snapshot_subjects := v_snapshot_subjects || jsonb_build_array(jsonb_build_object(
        'exam_paper_id', v_paper.exam_paper_id,
        'subject_id', v_paper.subject_id,
        'marks_obtained', v_paper.marks_obtained,
        'max_marks', v_paper.max_marks,
        'is_absent', v_paper.is_absent,
        'passed', (not v_paper.is_absent) and v_paper.marks_obtained >= v_paper.pass_marks,
        'grade', case when v_paper.is_absent or v_paper.marks_obtained is null then null
                       else app.grade_for(v_exam.institution_id, v_exam.grading_scale_key, round(v_paper.marks_obtained / v_paper.max_marks * 100, 2)) end
      ));
      v_total := v_total + coalesce(v_paper.marks_obtained, 0);
      v_max_total := v_max_total + v_paper.max_marks;
    end loop;

    v_percentage := case when v_max_total > 0 then round(v_total / v_max_total * 100, 2) else 0 end;
    v_grade := app.grade_for(v_exam.institution_id, v_exam.grading_scale_key, v_percentage);
    v_attendance_pct := app.term_attendance_percentage(v_exam.institution_id, v_student.student_id, v_exam.term_id);

    insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
    values (
      v_exam.institution_id, p_exam_id, v_student.student_id,
      jsonb_build_object('subjects', v_snapshot_subjects, 'attendancePercentage', v_attendance_pct),
      v_total, v_max_total, v_percentage, v_grade, 1, now()
    )
    returning id into v_result_id;

    v_result_count := v_result_count + 1;

    perform app.enqueue_job(
      v_exam.institution_id,
      'notify.results_published',
      jsonb_build_object('result_id', v_result_id, 'student_id', v_student.student_id, 'exam_id', p_exam_id),
      'result:' || v_result_id
    );
  end loop;

  update public.exams set status = 'published', published_at = now() where id = p_exam_id;

  perform app.audit(
    v_exam.institution_id,
    app.current_user_id(),
    'exam.published',
    'exam',
    p_exam_id,
    jsonb_build_object('status', v_exam.status),
    jsonb_build_object('status', 'published', 'result_count', v_result_count),
    null
  );

  return jsonb_build_object('exam_id', p_exam_id, 'result_count', v_result_count);
end;
$$;

revoke execute on function app.publish_exam_results(uuid) from public, anon, authenticated;

create function public.publish_exam_results(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.publish_exam_results(p_exam_id);
end;
$$;

revoke execute on function public.publish_exam_results(uuid) from public, anon;
grant execute on function public.publish_exam_results(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- app.apply_recheck_decision(request_id, decision, new_marks, note) — 06
-- §W8, §4. Same role-check placement as publish_exam_results above.
-- ---------------------------------------------------------------------------

create function app.apply_recheck_decision(p_request_id uuid, p_decision text, p_new_marks numeric, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.recheck_requests;
  v_paper public.exam_papers;
  v_result public.results;
  v_exam public.exams;
  v_old_marks public.marks;
  v_new_marks_id uuid;
  v_new_result_id uuid;
  v_new_version int;
  v_new_total numeric(8, 2);
  v_new_max_total numeric(8, 2);
  v_new_percentage numeric(5, 2);
  v_new_grade text;
  v_new_snapshot_subjects jsonb;
  v_subject record;
  v_attendance_pct numeric;
  v_decision_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'code:validation_failed' using detail = 'decision must be approve or reject';
  end if;

  select * into v_request from public.recheck_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'code:not_found' using detail = 'recheck request not found';
  end if;

  if not app.has_role(v_request.institution_id, app.exam_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.recheck.decide for this institution';
  end if;

  if v_request.status <> 'under_review' then
    raise exception 'code:invalid_state' using detail = format('request must be under_review to decide; current status is %s', v_request.status);
  end if;

  select * into v_paper from public.exam_papers where id = v_request.exam_paper_id;
  select * into v_result from public.results where id = v_request.result_id for update;
  select * into v_exam from public.exams where id = v_result.exam_id;

  if p_decision = 'reject' then
    update public.recheck_requests set status = 'rejected' where id = p_request_id;

    insert into public.recheck_decisions (institution_id, request_id, decided_by, decision, note)
    values (v_request.institution_id, p_request_id, app.current_user_id(), 'reject', p_note)
    returning id into v_decision_id;

    perform app.audit(
      v_request.institution_id, app.current_user_id(), 'exam.recheck.rejected', 'recheck_request', p_request_id,
      jsonb_build_object('status', 'under_review'), jsonb_build_object('status', 'rejected'), null
    );

    perform app.enqueue_job(
      v_request.institution_id, 'notify.recheck_decided',
      jsonb_build_object('request_id', p_request_id, 'decision', 'reject', 'result_id', v_request.result_id),
      'recheck:' || p_request_id
    );

    return jsonb_build_object('request_id', p_request_id, 'decision', 'reject', 'decision_id', v_decision_id);
  end if;

  -- approve
  if p_new_marks is null then
    raise exception 'code:validation_failed' using detail = 'newMarks is required to approve a recheck';
  end if;

  if p_new_marks < 0 or p_new_marks > v_paper.max_marks then
    raise exception 'code:validation_failed' using detail = format('newMarks must be between 0 and %s', v_paper.max_marks);
  end if;

  select * into v_old_marks from public.marks
  where exam_paper_id = v_request.exam_paper_id and student_id = v_result.student_id and superseded_by is null
  for update;

  if v_old_marks.id is null then
    raise exception 'code:not_found' using detail = 'no current marks row for this paper and student';
  end if;

  if p_new_marks = v_old_marks.marks_obtained then
    raise exception 'code:validation_failed' using detail = 'newMarks matches the current marks';
  end if;

  v_new_version := v_old_marks.version_no + 1;

  -- Fix round 1 (CRITICAL): the exam is normally 'published' by the time a
  -- recheck is decided, which app.marks_guard would otherwise reject — this
  -- is exactly the GUC it allows through. Insert the new row FIRST (so the
  -- guard's cross-row validation on the UPDATE below has a real, newer,
  -- still-current row to check against), then update the old row to point
  -- at it; app.marks_one_current_check (deferred to commit) tolerates the
  -- momentary pair of superseded_by-null rows in between.
  perform set_config('app.allow_marks_revision', 'on', true);

  insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent, version_no, source, entered_by)
  values (v_request.institution_id, v_request.exam_paper_id, v_result.student_id, p_new_marks, false, v_new_version, 'recheck', app.current_user_id())
  returning id into v_new_marks_id;

  update public.marks set superseded_by = v_new_marks_id where id = v_old_marks.id;

  v_new_snapshot_subjects := '[]'::jsonb;
  v_new_total := 0;
  v_new_max_total := 0;

  for v_subject in
    select p.id as exam_paper_id, p.subject_id, p.max_marks, p.pass_marks, m.marks_obtained, m.is_absent
    from public.exam_papers p
    join public.enrolments e on e.class_section_id = p.class_section_id and e.status = 'active'
    left join public.marks m on m.exam_paper_id = p.id and m.student_id = v_result.student_id and m.superseded_by is null
    where p.exam_id = v_result.exam_id and e.student_id = v_result.student_id
  loop
    v_new_snapshot_subjects := v_new_snapshot_subjects || jsonb_build_array(jsonb_build_object(
      'exam_paper_id', v_subject.exam_paper_id,
      'subject_id', v_subject.subject_id,
      'marks_obtained', v_subject.marks_obtained,
      'max_marks', v_subject.max_marks,
      'is_absent', v_subject.is_absent,
      'passed', (not v_subject.is_absent) and v_subject.marks_obtained >= v_subject.pass_marks,
      'grade', case when v_subject.is_absent or v_subject.marks_obtained is null then null
                     else app.grade_for(v_exam.institution_id, v_exam.grading_scale_key, round(v_subject.marks_obtained / v_subject.max_marks * 100, 2)) end
    ));
    v_new_total := v_new_total + coalesce(v_subject.marks_obtained, 0);
    v_new_max_total := v_new_max_total + v_subject.max_marks;
  end loop;

  v_new_percentage := case when v_new_max_total > 0 then round(v_new_total / v_new_max_total * 100, 2) else 0 end;
  v_new_grade := app.grade_for(v_exam.institution_id, v_exam.grading_scale_key, v_new_percentage);
  v_attendance_pct := app.term_attendance_percentage(v_exam.institution_id, v_result.student_id, v_exam.term_id);

  -- Same ordering reason as marks above: update the old row to point at the
  -- new id before inserting the new (still-current) row.
  v_new_result_id := gen_random_uuid();
  update public.results set superseded_by = v_new_result_id where id = v_result.id;

  insert into public.results (id, institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
  values (
    v_new_result_id, v_exam.institution_id, v_result.exam_id, v_result.student_id,
    jsonb_build_object('subjects', v_new_snapshot_subjects, 'attendancePercentage', v_attendance_pct),
    v_new_total, v_new_max_total, v_new_percentage, v_new_grade, v_result.version_no + 1, now()
  );

  update public.recheck_requests set status = 'applied' where id = p_request_id;

  insert into public.recheck_decisions (institution_id, request_id, decided_by, decision, new_marks, note, applied_marks_id, applied_result_id)
  values (v_request.institution_id, p_request_id, app.current_user_id(), 'approve', p_new_marks, p_note, v_new_marks_id, v_new_result_id)
  returning id into v_decision_id;

  perform app.enqueue_job(
    v_request.institution_id, 'notify.recheck_decided',
    jsonb_build_object('request_id', p_request_id, 'decision', 'approve', 'result_id', v_new_result_id),
    'recheck:' || p_request_id
  );

  return jsonb_build_object(
    'request_id', p_request_id, 'decision', 'approve', 'decision_id', v_decision_id,
    'marks_id', v_new_marks_id, 'result_id', v_new_result_id
  );
end;
$$;

revoke execute on function app.apply_recheck_decision(uuid, text, numeric, text) from public, anon, authenticated;

create function public.apply_recheck_decision(p_request_id uuid, p_decision text, p_new_marks numeric, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.apply_recheck_decision(p_request_id, p_decision, p_new_marks, p_note);
end;
$$;

revoke execute on function public.apply_recheck_decision(uuid, text, numeric, text) from public, anon;
grant execute on function public.apply_recheck_decision(uuid, text, numeric, text) to authenticated;
