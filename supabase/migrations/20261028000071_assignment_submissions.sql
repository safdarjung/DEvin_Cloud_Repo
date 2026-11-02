-- M09-T2: assignment_submissions status/grade columns, RLS rewrite
-- (definer-only writes), submit_assignment/grade_submission RPCs, documents
-- `submission` entity branches (M09-tasks.md rulings).
--
-- 0005's assignment_submissions let the student who owns a row write its
-- own score/feedback directly via its INSERT/UPDATE policies (self-grading
-- hole). Closed here: those two policies are dropped and never replaced —
-- every write now goes through the two SECURITY DEFINER RPCs below (same
-- app.*/public.* thin-wrapper split as 0069's publish_timetable), so no
-- guard trigger is needed on this table (grants unchanged, RLS has no
-- INSERT/UPDATE/DELETE policy at all).

alter table public.assignment_submissions
  add column status text not null default 'submitted' check (status in ('submitted', 'graded')),
  add column attempt int not null default 1 check (attempt >= 1),
  add column is_late boolean not null default false,
  add column max_score numeric(6, 2) check (max_score > 0 and max_score <= 1000),
  add column graded_by uuid references public.profiles (id),
  add column graded_at timestamptz,
  alter column score type numeric(6, 2);

alter table public.assignment_submissions
  add constraint assignment_submissions_score_range check (score is null or score between 0 and max_score),
  add constraint assignment_submissions_graded_consistency check (
    (status = 'graded') = (score is not null and max_score is not null and graded_at is not null and graded_by is not null)
  ),
  add constraint assignment_submissions_feedback_length check (feedback is null or length(feedback) <= 2000),
  add constraint assignment_submissions_content_object check (content is null or jsonb_typeof(content) = 'object');

-- ---------------------------------------------------------------------------
-- RLS rewrite (07 §2.2 assignment.read). No INSERT/UPDATE/DELETE policy.
-- ---------------------------------------------------------------------------

drop policy assignment_submissions_select on public.assignment_submissions;
drop policy assignment_submissions_insert on public.assignment_submissions;
drop policy assignment_submissions_update on public.assignment_submissions;

create policy assignment_submissions_select on public.assignment_submissions
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_submissions.assignment_id
        and a.institution_id = assignment_submissions.institution_id
        and (
          a.class_section_id = any((select app.my_class_teacher_section_ids()))
          or (a.class_section_id, a.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
        )
    )
    or student_id = any((select app.my_student_ids()))
  );

-- ---------------------------------------------------------------------------
-- app.submit_assignment / public.submit_assignment
-- ---------------------------------------------------------------------------

create function app.submit_assignment(p_assignment_id uuid, p_text text default null, p_answers jsonb default null)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments;
  v_student_id uuid;
  v_content jsonb;
  v_is_late boolean;
  v_submission public.assignment_submissions;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id;
  if v_assignment.id is null or v_assignment.status = 'draft' then
    raise exception 'code:not_found' using detail = 'assignment not found';
  end if;

  v_student_id := app.own_student_id(v_assignment.institution_id);

  if v_student_id is null or not exists (
    select 1 from public.enrolments e
    where e.student_id = v_student_id
      and e.class_section_id = v_assignment.class_section_id
      and e.status = 'active'
  ) then
    raise exception 'code:forbidden' using detail = 'caller is not an active student of this assignment''s section';
  end if;

  if v_assignment.status = 'closed' then
    raise exception 'code:invalid_state' using detail = 'assignment is closed';
  end if;

  if p_text is not null and length(p_text) > 5000 then
    raise exception 'code:validation_failed' using detail = 'text exceeds 5000 characters';
  end if;

  if p_answers is not null then
    if jsonb_typeof(p_answers) <> 'array' then
      raise exception 'code:validation_failed' using detail = 'answers must be an array of strings';
    end if;
    if jsonb_array_length(p_answers) > 30 then
      raise exception 'code:validation_failed' using detail = 'answers exceeds 30 items';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_answers) elem
      where jsonb_typeof(elem) <> 'string' or length(elem #>> '{}') > 500
    ) then
      raise exception 'code:validation_failed' using detail = 'each answer must be a string of at most 500 characters';
    end if;
  end if;

  v_content := jsonb_strip_nulls(jsonb_build_object('text', p_text, 'answers', p_answers));
  if v_content = '{}'::jsonb then
    v_content := null;
  end if;

  v_is_late := v_assignment.due_at is not null and now() > v_assignment.due_at;

  insert into public.assignment_submissions (institution_id, assignment_id, student_id, content, is_late, status, attempt)
  values (v_assignment.institution_id, v_assignment.id, v_student_id, v_content, v_is_late, 'submitted', 1)
  on conflict (assignment_id, student_id) do update
    set content = excluded.content,
        attempt = assignment_submissions.attempt + 1,
        submitted_at = now(),
        is_late = excluded.is_late
    where assignment_submissions.status = 'submitted'
  returning * into v_submission;

  if v_submission.id is null then
    raise exception 'code:invalid_state' using detail = 'submission already graded';
  end if;

  perform app.audit(
    v_assignment.institution_id,
    app.current_user_id(),
    'assignment.submitted',
    'assignment_submission',
    v_submission.id,
    null,
    null,
    jsonb_build_object('attempt', v_submission.attempt, 'isLate', v_submission.is_late)
  );

  return v_submission;
end;
$$;

revoke execute on function app.submit_assignment(uuid, text, jsonb) from public, anon, authenticated;

create function public.submit_assignment(p_assignment_id uuid, p_text text default null, p_answers jsonb default null)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.submit_assignment(p_assignment_id, p_text, p_answers);
end;
$$;

revoke execute on function public.submit_assignment(uuid, text, jsonb) from public, anon;
grant execute on function public.submit_assignment(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- app.grade_submission / public.grade_submission
-- ---------------------------------------------------------------------------

create function app.grade_submission(p_submission_id uuid, p_score numeric, p_max_score numeric, p_feedback text default null)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.assignment_submissions;
  v_assignment public.assignments;
  v_before jsonb;
  v_regrade boolean;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_submission from public.assignment_submissions where id = p_submission_id for update;
  if v_submission.id is null then
    raise exception 'code:not_found' using detail = 'submission not found';
  end if;

  select * into v_assignment from public.assignments where id = v_submission.assignment_id;

  if not (
    app.has_role(v_submission.institution_id, array['owner', 'principal'])
    or v_assignment.class_section_id = any((select app.my_class_teacher_section_ids()))
    or (v_assignment.class_section_id, v_assignment.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
  ) then
    raise exception 'code:forbidden' using detail = 'caller does not hold assignment.manage for this submission';
  end if;

  if p_max_score <= 0 or p_max_score > 1000 then
    raise exception 'code:validation_failed' using detail = 'maxScore must be > 0 and <= 1000';
  end if;
  if p_score < 0 or p_score > p_max_score then
    raise exception 'code:validation_failed' using detail = 'score must be between 0 and maxScore';
  end if;
  if p_feedback is not null and length(p_feedback) > 2000 then
    raise exception 'code:validation_failed' using detail = 'feedback exceeds 2000 characters';
  end if;

  v_regrade := v_submission.status = 'graded';
  v_before := jsonb_build_object('status', v_submission.status);

  update public.assignment_submissions
  set status = 'graded',
      score = p_score,
      max_score = p_max_score,
      feedback = p_feedback,
      graded_by = app.current_user_id(),
      graded_at = now()
  where id = p_submission_id
  returning * into v_submission;

  perform app.audit(
    v_submission.institution_id,
    app.current_user_id(),
    'assignment.graded',
    'assignment_submission',
    v_submission.id,
    v_before,
    jsonb_build_object('status', 'graded'),
    jsonb_build_object('regrade', v_regrade)
  );

  return v_submission;
end;
$$;

revoke execute on function app.grade_submission(uuid, numeric, numeric, text) from public, anon, authenticated;

create function public.grade_submission(p_submission_id uuid, p_score numeric, p_max_score numeric, p_feedback text default null)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.grade_submission(p_submission_id, p_score, p_max_score, p_feedback);
end;
$$;

revoke execute on function public.grade_submission(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.grade_submission(uuid, numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- documents: enable the `submission` entity (0067's policies recreated
-- verbatim plus the new branches below; every existing branch unchanged).
-- ---------------------------------------------------------------------------

drop policy documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      entity_type in ('student', 'application')
      and institution_id = any((select app.my_institution_ids(array['admissions'])))
    )
    or (
      entity_type = 'staff'
      and exists (
        select 1 from public.staff s
        where s.id = documents.entity_id
          and s.institution_id = documents.institution_id
          and s.user_id = app.current_user_id()
      )
    )
    or (
      entity_type = 'student'
      and entity_id = any((select app.my_student_ids()))
    )
    or (
      entity_type = 'submission'
      and exists (
        select 1 from public.assignment_submissions sub
        where sub.id = documents.entity_id and sub.institution_id = documents.institution_id
      )
    )
  );

drop policy documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    created_by = app.current_user_id()
    -- Rows start pending, and the object path must sit under this row's own
    -- institution/entity prefix, so no row can point at another tenant's file.
    and status = 'pending'
    and path like documents.institution_id::text || '/' || documents.entity_type || '/' || documents.entity_id::text || '/%'
    and (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or (
        entity_type in ('student', 'application')
        and app.has_role(institution_id, array['admissions'])
      )
      or (
        entity_type = 'submission'
        and exists (
          select 1 from public.assignment_submissions sub
          where sub.id = documents.entity_id
            and sub.institution_id = documents.institution_id
            and sub.status = 'submitted'
            and sub.student_id = app.own_student_id(documents.institution_id)
        )
      )
    )
    and (
      entity_type <> 'student'
      or exists (select 1 from public.students s where s.id = documents.entity_id and s.institution_id = documents.institution_id)
    )
    and (
      entity_type <> 'staff'
      or exists (select 1 from public.staff s where s.id = documents.entity_id and s.institution_id = documents.institution_id)
    )
    and (
      entity_type <> 'application'
      or exists (select 1 from public.applications a where a.id = documents.entity_id and a.institution_id = documents.institution_id)
    )
    and (
      entity_type <> 'submission'
      or exists (select 1 from public.assignment_submissions sub where sub.id = documents.entity_id and sub.institution_id = documents.institution_id)
    )
  );

drop policy documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    or (
      entity_type in ('student', 'application')
      and app.has_role(institution_id, array['admissions'])
    )
    or (
      entity_type = 'submission'
      and created_by = app.current_user_id()
      and exists (
        select 1 from public.assignment_submissions sub
        where sub.id = documents.entity_id
          and sub.institution_id = documents.institution_id
          and sub.status = 'submitted'
          and sub.student_id = app.own_student_id(documents.institution_id)
      )
    )
  )
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    or (
      entity_type in ('student', 'application')
      and app.has_role(institution_id, array['admissions'])
    )
    or (
      entity_type = 'submission'
      and created_by = app.current_user_id()
      and exists (
        select 1 from public.assignment_submissions sub
        where sub.id = documents.entity_id
          and sub.institution_id = documents.institution_id
          and sub.status = 'submitted'
          and sub.student_id = app.own_student_id(documents.institution_id)
      )
    )
  );
