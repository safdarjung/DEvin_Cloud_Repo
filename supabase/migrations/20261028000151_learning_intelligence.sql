-- 0151 — Learning intelligence (15-learning-exam-system-plan.md, Phase 5).
--
-- 1. Practice with server-held keys. public.practice_sessions holds the
--    questions WITH their keys; students have no grant or policy on it. A
--    session starts either from approved question_bank questions
--    (public.start_bank_practice, student) or from an AI-generated quiz
--    (public.create_ai_practice_session, service_role only: the Next route
--    writes the generated key after its own checks, so a student can never
--    supply a key). public.submit_practice_session marks every item with
--    app.mark_test_item (0150, the online-test marker) and records the
--    practice_attempts row. public.submit_practice_attempt (0103), which took
--    the key from the client, is dropped: the fakeable score is gone.
--    Bank questions held for an exam that is still ahead (any non-archived
--    paper, traced by question_paper_items.derived_from_question_id, 0149) or
--    for an online test that has not closed are never served to practice, nor
--    questions with question_bank.practice_allowed = false. One open session
--    per student (a repeat start resumes it; another start or an AI set
--    supersedes it) and at most 30 new sessions per student per day.
-- 2. Analytics from per-question results. app.learning_obs flattens online
--    test responses (one row per submitted attempt and item) and submitted
--    practice sessions. Definer reads:
--      public.learning_section_topic_rows   teacher of the (section, subject)
--                                           or app.exam_write_roles()
--      public.learning_test_section_rows    same scope, one test, one section;
--                                           the paper without answers or keys
--      public.learning_student_topic_rows   the student or a linked guardian
--      public.learning_progress             the student or a linked guardian
--      public.practice_bank_counts          the student or a linked guardian
--    Students and guardians see a test only once its results are released.
-- 3. compute_mastery also takes released online-test results (weight 1 per
--    attempt and unit, new mastery_snapshots.test_count). It becomes security
--    definer so it can read the frozen test items through the internal app
--    helpers; it stays service_role only. Marks are untouched.

-- ---------------------------------------------------------------------------
-- practice_attempts: a bank set may mix difficulties.
-- ---------------------------------------------------------------------------

alter table public.practice_attempts drop constraint practice_attempts_difficulty_check;
alter table public.practice_attempts
  add constraint practice_attempts_difficulty_check check (difficulty in ('easy', 'medium', 'hard', 'mixed'));

-- 0103's guard still named the dropped submit_practice_attempt.
create or replace function app.guard_practice_attempts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return coalesce(new, old);
  end if;

  if tg_op <> 'INSERT' then
    raise exception 'code:invalid_state' using detail = 'practice attempts are immutable';
  end if;

  if current_setting('app.allow_practice_write', true) is distinct from 'on' then
    raise exception 'code:forbidden' using detail = 'practice attempts are recorded only via submit_practice_session';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- question_bank.practice_allowed: a teacher or reviewer can keep a question
-- out of practice. Not content, so app.question_bank_guard lets a non-reviewer
-- toggle it on an approved AI/import row (same body as 0146 otherwise).
-- ---------------------------------------------------------------------------

alter table public.question_bank add column practice_allowed boolean not null default true;
grant update (practice_allowed) on public.question_bank to authenticated;

create or replace function app.question_bank_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_reviewer boolean;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'approved' else 'archived' end;
  end if;
  new.is_active := new.status = 'approved';

  if new.stem_question_id is not null
     and (tg_op = 'INSERT' or new.stem_question_id is distinct from old.stem_question_id) then
    if new.type in ('passage', 'case_based') or not exists (
      select 1 from public.question_bank s
      where s.id = new.stem_question_id
        and s.institution_id = new.institution_id
        and s.grade_id = new.grade_id
        and s.subject_id = new.subject_id
        and s.type in ('passage', 'case_based')
    ) then
      raise exception 'code:validation_failed' using detail = 'A sub-question must sit under a passage or case-based question of the same grade and subject.';
    end if;
  end if;

  if new.source_subject_textbook_id is not null
     and (tg_op = 'INSERT'
          or (new.source_subject_textbook_id, new.grade_id, new.subject_id)
             is distinct from (old.source_subject_textbook_id, old.grade_id, old.subject_id))
     and not exists (
       select 1 from public.subject_textbooks st
       where st.id = new.source_subject_textbook_id
         and st.institution_id = new.institution_id
         and st.grade_id = new.grade_id
         and st.subject_id = new.subject_id
     ) then
    raise exception 'code:validation_failed' using detail = 'The source textbook is not mapped to this grade and subject.';
  end if;

  if v_uid is null then
    return new;
  end if;

  v_reviewer := new.institution_id in (select app.my_institution_ids(app.exam_write_roles()));

  if tg_op = 'INSERT' then
    if not v_reviewer then
      new.review_note := null;
      if new.status = 'rejected' or (new.status = 'approved' and new.origin <> 'manual') then
        raise exception 'code:forbidden' using detail = 'Only a reviewer can approve or reject questions from AI or import.';
      end if;
    end if;
    if new.status in ('approved', 'rejected') and new.origin <> 'manual' then
      new.reviewed_by := v_uid;
      new.reviewed_at := now();
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
    return new;
  end if;

  if not v_reviewer then
    new.review_note := old.review_note;
    -- Whole row, so a column added later is locked by default. Depth 1 only:
    -- an FK "on delete set null" (topic, textbook, stem deleted) runs nested.
    if old.status = 'approved' and old.origin <> 'manual' and pg_trigger_depth() = 1
       and to_jsonb(new) - array['status', 'is_active', 'updated_at', 'practice_allowed'] is distinct from to_jsonb(old) - array['status', 'is_active', 'updated_at', 'practice_allowed'] then
      raise exception 'code:forbidden' using detail = 'This question was approved after review. Duplicate it to make changes.';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not v_reviewer and (new.status = 'rejected' or (new.status = 'approved' and new.origin <> 'manual')) then
      raise exception 'code:forbidden' using detail = 'Only a reviewer can approve or reject questions from AI or import.';
    end if;
    if new.status in ('approved', 'rejected') then
      new.reviewed_by := v_uid;
      new.reviewed_at := now();
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- practice_sessions
-- items: [{ key, type, body, options, marks, answer, answer_key, explanation,
--           unit, topic }] — the shape app.mark_test_item reads.
-- results (after submit): [{ key, type, unit, topic, marks, awarded, correct,
--           given, answer, answerKey, explanation }]
-- ---------------------------------------------------------------------------

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  subject_id uuid not null references public.subjects (id),
  curriculum_unit_id uuid not null references public.curriculum_units (id),
  curriculum_topic_id uuid references public.curriculum_topics (id) on delete set null,
  source text not null check (source in ('ai', 'bank')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard', 'mixed')),
  items jsonb not null check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 15 and pg_column_size(items) <= 131072
  ),
  results jsonb check (results is null or jsonb_typeof(results) = 'array'),
  attempt_id uuid unique references public.practice_attempts (id),
  expires_at timestamptz not null default now() + interval '6 hours',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index practice_sessions_student_idx on public.practice_sessions (student_id, created_at desc);
create index practice_sessions_institution_idx on public.practice_sessions (institution_id);

create trigger set_updated_at
before update on public.practice_sessions
for each row execute function app.set_updated_at();

-- Keys live here: RLS on and no policy, so every client read returns no rows
-- (SELECT is granted only so the generated RLS suite can prove that); no write
-- grant. Reads and writes go through the definer functions below.
alter table public.practice_sessions enable row level security;
revoke all on public.practice_sessions from anon, authenticated;
grant select on public.practice_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (definer callers only)
-- ---------------------------------------------------------------------------

-- The unit's subject when the unit is in the student's grade and the subject
-- is taught in the student's active section; null otherwise.
create function app.practice_unit_subject(p_institution_id uuid, p_student_id uuid, p_unit_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select cu.subject_id
  from public.curriculum_units cu
  where cu.id = p_unit_id
    and cu.institution_id = p_institution_id
    and exists (
      select 1
      from public.enrolments e
      join public.class_sections cs on cs.id = e.class_section_id and cs.institution_id = e.institution_id
      join public.subject_assignments sa on sa.class_section_id = e.class_section_id and sa.subject_id = cu.subject_id
      where e.student_id = p_student_id
        and e.institution_id = p_institution_id
        and e.status = 'active'
        and cs.grade_id = cu.grade_id
    );
$$;

revoke execute on function app.practice_unit_subject(uuid, uuid, uuid) from public;

-- Approved, auto-markable, stand-alone, practice-allowed bank questions of the
-- student's grade and section subjects, minus questions (by lineage, so an
-- edited paper item still counts) in a non-archived paper whose exam is not
-- over, or in an online test that has not closed: practice must not leak an
-- exam's answers. Exam over = linked exam published and its paper held before
-- today; with no exam link, the paper's exam_date is before today.
create function app.practice_pool(p_institution_id uuid, p_student_id uuid)
returns setof public.question_bank
language sql
stable
set search_path = ''
as $$
  select q.*
  from public.question_bank q
  where q.institution_id = p_institution_id
    and q.status = 'approved'
    and q.stem_question_id is null
    and q.curriculum_unit_id is not null
    and app.is_objective_type(q.type)
    and q.practice_allowed
    and exists (
      select 1
      from public.enrolments e
      join public.class_sections cs on cs.id = e.class_section_id and cs.institution_id = e.institution_id
      join public.subject_assignments sa on sa.class_section_id = e.class_section_id and sa.subject_id = q.subject_id
      where e.student_id = p_student_id
        and e.institution_id = p_institution_id
        and e.status = 'active'
        and cs.grade_id = q.grade_id
    )
    and not exists (
      select 1
      from public.question_paper_items i
      join public.question_papers p on p.id = i.paper_id
      left join public.exam_papers ep on ep.id = p.exam_paper_id
      left join public.exams ex on ex.id = coalesce(ep.exam_id, p.exam_id)
      where i.derived_from_question_id = q.id
        and i.institution_id = p_institution_id
        and (
          (p.status <> 'archived' and not coalesce(
            case
              when ex.id is null then p.exam_date < (now() at time zone 'Asia/Kolkata')::date
              else ex.status = 'published' and coalesce(ep.held_on, p.exam_date) < (now() at time zone 'Asia/Kolkata')::date
            end,
            false
          ))
          or exists (
            select 1 from public.online_tests t
            where t.question_paper_id = p.id and t.status in ('draft', 'scheduled', 'open')
          )
        )
    );
$$;

revoke execute on function app.practice_pool(uuid, uuid) from public;

-- What a student may see of session items: never answer, answer_key or explanation.
create function app.practice_public_items(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('key', i -> 'key', 'type', i -> 'type', 'body', i -> 'body', 'options', i -> 'options', 'marks', i -> 'marks')
    order by n
  ), '[]'::jsonb)
  from jsonb_array_elements(p_items) with ordinality as x(i, n);
$$;

revoke execute on function app.practice_public_items(jsonb) from public;

-- Before a new session: serialise the student's starts, cap them at 30 a day
-- (Asia/Kolkata), and expire any other open session (one open at a time).
create function app.practice_make_room(p_student_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('practice_sessions:' || p_student_id::text, 0));
  if (
    select count(*) from public.practice_sessions s
    where s.student_id = p_student_id
      and s.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
  ) >= 30 then
    raise exception 'code:rate_limited' using detail = 'You have started 30 practice sets today. Try again tomorrow.';
  end if;
  update public.practice_sessions
  set expires_at = now()
  where student_id = p_student_id and submitted_at is null and expires_at > now();
end;
$$;

revoke execute on function app.practice_make_room(uuid) from public;

-- ---------------------------------------------------------------------------
-- public.start_bank_practice — the caller is the student. Questions seen in
-- the last 14 days come last, so a small bank still fills the set. An open
-- bank session for the same unit, topic and difficulty is returned as is
-- (resumed: true) instead of a new one.
-- ---------------------------------------------------------------------------

create function public.start_bank_practice(
  p_institution_id uuid,
  p_curriculum_unit_id uuid,
  p_topic_id uuid default null,
  p_difficulty text default null,
  p_count int default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_subject uuid;
  v_items jsonb;
  v_id uuid;
  v_open public.practice_sessions;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;
  if not app.is_member(p_institution_id) then
    raise exception 'code:not_found' using detail = 'institution not found';
  end if;
  if not app.module_enabled(p_institution_id, 'practice') then
    raise exception 'code:forbidden' using detail = 'practice is not enabled for this school';
  end if;
  v_student := app.own_student_id(p_institution_id);
  if v_student is null then
    raise exception 'code:forbidden' using detail = 'practice sets are for students';
  end if;
  if p_count is null or p_count not between 1 and 15 then
    raise exception 'code:validation_failed' using detail = 'choose 1 to 15 questions';
  end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'code:validation_failed' using detail = 'difficulty must be easy, medium or hard';
  end if;

  v_subject := app.practice_unit_subject(p_institution_id, v_student, p_curriculum_unit_id);
  if v_subject is null then
    raise exception 'code:not_found' using detail = 'chapter is not part of your subjects';
  end if;
  if p_topic_id is not null and not exists (
    select 1 from public.curriculum_topics t where t.id = p_topic_id and t.curriculum_unit_id = p_curriculum_unit_id
  ) then
    raise exception 'code:not_found' using detail = 'topic is not part of this chapter';
  end if;

  select * into v_open
  from public.practice_sessions s
  where s.student_id = v_student and s.source = 'bank' and s.submitted_at is null and s.expires_at > now()
    and s.curriculum_unit_id = p_curriculum_unit_id
    and s.curriculum_topic_id is not distinct from p_topic_id
    and s.difficulty = coalesce(p_difficulty, 'mixed')
  order by s.created_at desc
  limit 1;
  if v_open.id is not null then
    return jsonb_build_object('sessionId', v_open.id, 'questions', app.practice_public_items(v_open.items), 'resumed', true);
  end if;

  perform app.practice_make_room(v_student);

  with seen as (
    select (i ->> 'key')::uuid as qid
    from public.practice_sessions s
    cross join lateral jsonb_array_elements(s.items) i
    where s.student_id = v_student and s.source = 'bank' and s.created_at > now() - interval '14 days'
  ),
  picked as (
    select q.*, row_number() over (order by (sn.qid is not null), random()) as n
    from app.practice_pool(p_institution_id, v_student) q
    left join (select distinct qid from seen) sn on sn.qid = q.id
    where q.curriculum_unit_id = p_curriculum_unit_id
      and (
        p_topic_id is null
        or q.curriculum_topic_id = p_topic_id
        or q.curriculum_topic_id in (select t.id from public.curriculum_topics t where t.parent_id = p_topic_id)
      )
      and (p_difficulty is null or q.difficulty = p_difficulty)
  )
  select jsonb_agg(jsonb_build_object(
      'key', p.id, 'type', p.type, 'body', p.body, 'options', p.options, 'marks', p.marks,
      'answer', p.answer, 'answer_key', p.answer_key, 'explanation', p.explanation,
      'unit', p.curriculum_unit_id, 'topic', p.curriculum_topic_id
    ) order by p.n)
  into v_items
  from picked p
  where p.n <= p_count;

  if v_items is null then
    raise exception 'code:not_found' using detail = 'no approved practice questions for this chapter yet';
  end if;

  insert into public.practice_sessions (
    institution_id, student_id, subject_id, curriculum_unit_id, curriculum_topic_id, source, difficulty, items
  ) values (
    p_institution_id, v_student, v_subject, p_curriculum_unit_id, p_topic_id, 'bank', coalesce(p_difficulty, 'mixed'), v_items
  )
  returning id into v_id;

  return jsonb_build_object('sessionId', v_id, 'questions', app.practice_public_items(v_items), 'resumed', false);
end;
$$;

revoke execute on function public.start_bank_practice(uuid, uuid, uuid, text, int) from public, anon;
grant execute on function public.start_bank_practice(uuid, uuid, uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- public.create_ai_practice_session — service_role only (src/modules/practice/
-- service-role.ts, called by /api/ai/practice-quiz after its own checks).
-- p_questions: [{ stem, options: [4 x text], answerIndex: 0..3, explanation? }]
-- ---------------------------------------------------------------------------

create function public.create_ai_practice_session(
  p_institution_id uuid,
  p_student_id uuid,
  p_curriculum_unit_id uuid,
  p_difficulty text,
  p_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject uuid;
  v_q jsonb;
  v_items jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if not app.module_enabled(p_institution_id, 'practice') then
    raise exception 'code:forbidden' using detail = 'practice is not enabled for this school';
  end if;
  if p_difficulty is null or p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'code:validation_failed' using detail = 'difficulty must be easy, medium or hard';
  end if;
  v_subject := app.practice_unit_subject(p_institution_id, p_student_id, p_curriculum_unit_id);
  if v_subject is null then
    raise exception 'code:not_found' using detail = 'curriculum unit is not part of the student''s subjects';
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) not between 1 and 15 then
    raise exception 'code:validation_failed' using detail = '1-15 questions required';
  end if;

  for v_q in select * from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_q) is distinct from 'object'
      or jsonb_typeof(v_q -> 'stem') is distinct from 'string'
      or jsonb_typeof(v_q -> 'options') is distinct from 'array'
      or jsonb_array_length(v_q -> 'options') <> 4
      or jsonb_typeof(v_q -> 'answerIndex') is distinct from 'number'
      or (v_q ->> 'answerIndex') !~ '^[0-3]$'
    then
      raise exception 'code:validation_failed' using detail = 'a question is malformed';
    end if;
    if jsonb_typeof(v_q -> 'options' -> (v_q ->> 'answerIndex')::int) is distinct from 'string' then
      raise exception 'code:validation_failed' using detail = 'a question is malformed';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key', gen_random_uuid(), 'type', 'mcq', 'body', v_q -> 'stem', 'options', v_q -> 'options', 'marks', 1,
      'answer', v_q -> 'options' -> (v_q ->> 'answerIndex')::int, 'answer_key', null,
      'explanation', v_q -> 'explanation', 'unit', p_curriculum_unit_id, 'topic', null
    ));
  end loop;

  perform app.practice_make_room(p_student_id);

  insert into public.practice_sessions (
    institution_id, student_id, subject_id, curriculum_unit_id, source, difficulty, items
  ) values (
    p_institution_id, p_student_id, v_subject, p_curriculum_unit_id, 'ai', p_difficulty, v_items
  )
  returning id into v_id;

  return jsonb_build_object('sessionId', v_id, 'questions', app.practice_public_items(v_items));
end;
$$;

revoke execute on function public.create_ai_practice_session(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_ai_practice_session(uuid, uuid, uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- public.submit_practice_session — the session's own student, once, before it
-- expires. p_answers: one slot per item, in the online-test answer shape
-- (mcq: the option text; multi_select: array; fill_blank: array; numerical:
-- number or text; match: array; null = skipped). Score = items with full marks.
-- ---------------------------------------------------------------------------

create function public.submit_practice_session(p_session_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.practice_sessions;
  v_n int;
  v_i int;
  v_item jsonb;
  v_answer jsonb;
  v_awarded numeric;
  v_correct boolean;
  v_score int := 0;
  v_results jsonb := '[]'::jsonb;
  v_attempt_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_s from public.practice_sessions where id = p_session_id for update;
  if v_s.id is null or v_s.student_id is distinct from app.own_student_id(v_s.institution_id) then
    raise exception 'code:not_found' using detail = 'practice set not found';
  end if;
  if v_s.submitted_at is not null then
    raise exception 'code:invalid_state' using detail = 'this practice set was already submitted';
  end if;
  if v_s.expires_at < now() then
    raise exception 'code:invalid_state' using detail = 'this practice set has expired; start a new one';
  end if;

  v_n := jsonb_array_length(v_s.items);
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) <> v_n then
    raise exception 'code:validation_failed' using detail = 'one answer slot per question required';
  end if;
  -- practice_attempts.answers is capped at 4 KB.
  if octet_length(p_answers::text) > 3000 then
    raise exception 'code:validation_failed' using detail = 'answers are too long';
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_item := v_s.items -> v_i;
    v_answer := p_answers -> v_i;
    v_awarded := app.mark_test_item(v_item, v_answer, 0);
    v_correct := v_awarded >= (v_item ->> 'marks')::numeric;
    if v_correct then
      v_score := v_score + 1;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'key', v_item -> 'key', 'type', v_item -> 'type', 'unit', v_item -> 'unit', 'topic', v_item -> 'topic',
      'marks', v_item -> 'marks', 'awarded', v_awarded, 'correct', v_correct, 'given', v_answer,
      'answer', v_item -> 'answer', 'answerKey', v_item -> 'answer_key', 'explanation', v_item -> 'explanation'
    ));
  end loop;

  perform set_config('app.allow_practice_write', 'on', true);
  insert into public.practice_attempts (
    institution_id, student_id, curriculum_unit_id, subject_id, difficulty, questions, answers, score, max_score
  ) values (
    v_s.institution_id, v_s.student_id, v_s.curriculum_unit_id, v_s.subject_id, v_s.difficulty,
    (select jsonb_agg(e - 'explanation') from jsonb_array_elements(v_s.items) e), p_answers, v_score, v_n
  )
  returning id into v_attempt_id;

  update public.practice_sessions
  set results = v_results, attempt_id = v_attempt_id, submitted_at = now()
  where id = v_s.id;

  return jsonb_build_object('attemptId', v_attempt_id, 'score', v_score, 'maxScore', v_n, 'results', v_results);
end;
$$;

revoke execute on function public.submit_practice_session(uuid, jsonb) from public, anon;
grant execute on function public.submit_practice_session(uuid, jsonb) to authenticated;

-- The client-keyed path (0103) is gone.
drop function public.submit_practice_attempt(uuid, uuid, uuid, text, jsonb, jsonb);

-- ---------------------------------------------------------------------------
-- Learning observations: one row per answered-or-countable item.
-- Online tests: every submitted attempt x every frozen item; an unanswered
-- objective item counts 0 unless it sits in an OR group or a choose-N section
-- (the student may have skipped it by design). Written items count once a
-- teacher marked them. p_student_ids null = every student of the school.
-- ---------------------------------------------------------------------------

create function app.learning_obs(p_institution_id uuid, p_student_ids uuid[], p_released_only boolean)
returns table (
  student_id uuid,
  subject_id uuid,
  unit_id uuid,
  topic_id uuid,
  source text,
  source_id uuid,
  marks numeric,
  awarded numeric,
  on_date date
)
language sql
stable
set search_path = ''
as $$
  select a.student_id, t.subject_id,
    nullif(it.item ->> 'curriculum_unit_id', '')::uuid,
    nullif(it.item ->> 'curriculum_topic_id', '')::uuid,
    'test', a.id, (it.item ->> 'marks')::numeric,
    case when app.is_objective_type(it.item ->> 'type') then coalesce(r.auto_marks, 0) else r.teacher_marks end,
    (coalesce(a.submitted_at, a.started_at) at time zone 'Asia/Kolkata')::date
  from public.test_attempts a
  join public.online_tests t on t.id = a.test_id and t.institution_id = a.institution_id
  cross join lateral app.online_test_items(t.id) it
  left join public.test_responses r on r.attempt_id = a.id and r.item_key = it.item_key
  where a.institution_id = p_institution_id
    and (p_student_ids is null or a.student_id = any(p_student_ids))
    and a.status <> 'in_progress'
    and t.status not in ('draft', 'cancelled')
    and (not p_released_only or app.online_test_released(t.id, 'results'))
    and (
      app.has_answer(r.answer)
      or (it.item ->> 'choice_group' is null and nullif(it.section ->> 'choose_count', '') is null)
    )

  union all

  select s.student_id, s.subject_id,
    coalesce(nullif(x ->> 'unit', '')::uuid, s.curriculum_unit_id),
    nullif(x ->> 'topic', '')::uuid,
    'practice', s.id, (x ->> 'marks')::numeric, (x ->> 'awarded')::numeric,
    (s.submitted_at at time zone 'Asia/Kolkata')::date
  from public.practice_sessions s
  cross join lateral jsonb_array_elements(s.results) x
  where s.institution_id = p_institution_id
    and (p_student_ids is null or s.student_id = any(p_student_ids))
    and s.submitted_at is not null;
$$;

revoke execute on function app.learning_obs(uuid, uuid[], boolean) from public;

-- Per student x (unit, topic). Negative marking is floored at 0 per item.
create function app.learning_topic_agg(p_institution_id uuid, p_student_ids uuid[], p_released_only boolean, p_subject_id uuid)
returns table (
  student_id uuid,
  subject_id uuid,
  unit_id uuid,
  topic_id uuid,
  items int,
  awarded numeric,
  max_marks numeric,
  tests int,
  practice int,
  last_on date
)
language sql
stable
set search_path = ''
as $$
  select o.student_id, o.subject_id, o.unit_id, o.topic_id,
    count(*)::int,
    sum(greatest(o.awarded, 0)),
    sum(o.marks),
    (count(distinct o.source_id) filter (where o.source = 'test'))::int,
    (count(distinct o.source_id) filter (where o.source = 'practice'))::int,
    max(o.on_date)
  from app.learning_obs(p_institution_id, p_student_ids, p_released_only) o
  where o.awarded is not null
    and o.unit_id is not null
    and o.marks > 0
    and (p_subject_id is null or o.subject_id = p_subject_id)
  group by o.student_id, o.subject_id, o.unit_id, o.topic_id;
$$;

revoke execute on function app.learning_topic_agg(uuid, uuid[], boolean, uuid) from public;

-- Exam leadership (app.exam_write_roles(); not admin), or a teacher of this
-- subject in this section.
create function app.learning_can_view_section(p_institution_id uuid, p_class_section_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_role(p_institution_id, app.exam_write_roles())
    or exists (
      select 1 from app.my_taught_section_subjects() m
      where m.class_section_id = p_class_section_id and m.subject_id = p_subject_id
    );
$$;

revoke execute on function app.learning_can_view_section(uuid, uuid, uuid) from public;

create function app.learning_section_students(p_class_section_id uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(e.student_id), '{}')
  from public.enrolments e
  where e.class_section_id = p_class_section_id and e.status = 'active';
$$;

revoke execute on function app.learning_section_students(uuid) from public;

-- ---------------------------------------------------------------------------
-- Teacher reads
-- ---------------------------------------------------------------------------

create function public.learning_section_topic_rows(p_class_section_id uuid, p_subject_id uuid)
returns table (
  student_id uuid,
  subject_id uuid,
  unit_id uuid,
  topic_id uuid,
  items int,
  awarded numeric,
  max_marks numeric,
  tests int,
  practice int,
  last_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inst uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;
  select cs.institution_id into v_inst from public.class_sections cs where cs.id = p_class_section_id;
  if v_inst is null or not app.learning_can_view_section(v_inst, p_class_section_id, p_subject_id) then
    raise exception 'code:forbidden' using detail = 'you can see analytics only for sections you teach this subject in';
  end if;
  return query
    select * from app.learning_topic_agg(v_inst, app.learning_section_students(p_class_section_id), false, p_subject_id);
end;
$$;

revoke execute on function public.learning_section_topic_rows(uuid, uuid) from public, anon;
grant execute on function public.learning_section_topic_rows(uuid, uuid) to authenticated;

-- One test, one section: the frozen paper and that section's attempts and
-- responses, for computeAnalytics (src/modules/online-tests/marking.ts). The
-- paper comes without options, answers, keys, explanations or marking schemes
-- (analytics needs none of them), whatever the test's status.
create function public.learning_test_section_rows(p_test_id uuid, p_class_section_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_test public.online_tests;
  v_students uuid[];
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;
  select * into v_test from public.online_tests where id = p_test_id;
  if v_test.id is null or not app.is_member(v_test.institution_id) then
    raise exception 'code:not_found' using detail = 'test not found';
  end if;
  if not (p_class_section_id = any(v_test.section_ids))
    or not app.learning_can_view_section(v_test.institution_id, p_class_section_id, v_test.subject_id)
  then
    raise exception 'code:forbidden' using detail = 'you can see analytics only for sections you teach this subject in';
  end if;
  v_students := app.learning_section_students(p_class_section_id);

  return jsonb_build_object(
    'snapshot', (
      select jsonb_build_object('sections', coalesce(jsonb_agg(jsonb_build_object(
          'title', s -> 'title',
          'items', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'id', i -> 'id', 'type', i -> 'type', 'body', i -> 'body', 'marks', i -> 'marks',
                'curriculum_unit_id', i -> 'curriculum_unit_id', 'curriculum_topic_id', i -> 'curriculum_topic_id',
                'choice_group', i -> 'choice_group'
              ) order by ii), '[]'::jsonb)
            from jsonb_array_elements(s -> 'items') with ordinality y(i, ii)
          )
        ) order by si), '[]'::jsonb))
      from public.question_paper_versions v
      cross join lateral jsonb_array_elements(v.snapshot -> 'sections') with ordinality x(s, si)
      where v.paper_id = v_test.question_paper_id and v.version_no = v_test.paper_version_no
    ),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status, 'totalScore', a.total_score) order by a.id)
      from public.test_attempts a
      where a.test_id = p_test_id and a.student_id = any(v_students)
    ), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attemptId', r.attempt_id, 'itemKey', r.item_key, 'answer', r.answer,
        'autoMarks', r.auto_marks, 'teacherMarks', r.teacher_marks
      ) order by r.id)
      from public.test_responses r
      join public.test_attempts a on a.id = r.attempt_id
      where a.test_id = p_test_id and a.student_id = any(v_students)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.learning_test_section_rows(uuid, uuid) from public, anon;
grant execute on function public.learning_test_section_rows(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Student / guardian reads (app.my_student_ids: the student, linked guardians)
-- ---------------------------------------------------------------------------

create function app.learning_own_student_institution(p_student_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_inst uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;
  if p_student_id is null or p_student_id <> all (array(select app.my_student_ids())) then
    raise exception 'code:forbidden' using detail = 'only the student or a linked guardian can see this';
  end if;
  select st.institution_id into v_inst from public.students st where st.id = p_student_id;
  return v_inst;
end;
$$;

revoke execute on function app.learning_own_student_institution(uuid) from public;

create function public.learning_student_topic_rows(p_student_id uuid, p_subject_id uuid default null)
returns table (
  student_id uuid,
  subject_id uuid,
  unit_id uuid,
  topic_id uuid,
  items int,
  awarded numeric,
  max_marks numeric,
  tests int,
  practice int,
  last_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inst uuid := app.learning_own_student_institution(p_student_id);
begin
  return query select * from app.learning_topic_agg(v_inst, array[p_student_id], true, p_subject_id);
end;
$$;

revoke execute on function public.learning_student_topic_rows(uuid, uuid) from public, anon;
grant execute on function public.learning_student_topic_rows(uuid, uuid) to authenticated;

-- Weekly practice and evaluated, released test percentages over the last year.
create function public.learning_progress(p_student_id uuid, p_subject_id uuid default null)
returns table (week date, source text, attempts int, percent numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inst uuid := app.learning_own_student_institution(p_student_id);
begin
  return query
    select w.week, w.source, count(*)::int, round(avg(w.pct) * 100, 1)
    from (
      select date_trunc('week', (pa.created_at at time zone 'Asia/Kolkata'))::date as week, 'practice'::text as source,
        pa.score::numeric / pa.max_score as pct
      from public.practice_attempts pa
      where pa.student_id = p_student_id and pa.institution_id = v_inst
        and pa.created_at > now() - interval '1 year'
        and (p_subject_id is null or pa.subject_id = p_subject_id)
      union all
      select date_trunc('week', (a.submitted_at at time zone 'Asia/Kolkata'))::date, 'test',
        greatest(0, a.total_score) / nullif((v.snapshot -> 'paper' ->> 'total_marks')::numeric, 0)
      from public.test_attempts a
      join public.online_tests t on t.id = a.test_id and t.institution_id = a.institution_id
      join public.question_paper_versions v on v.paper_id = t.question_paper_id and v.version_no = t.paper_version_no
      where a.student_id = p_student_id and a.institution_id = v_inst
        and a.status = 'evaluated' and a.total_score is not null and a.submitted_at > now() - interval '1 year'
        and t.status not in ('draft', 'cancelled')
        and app.online_test_released(t.id, 'results')
        and (p_subject_id is null or t.subject_id = p_subject_id)
    ) w
    where w.pct is not null
    group by w.week, w.source
    order by w.week, w.source;
end;
$$;

revoke execute on function public.learning_progress(uuid, uuid) from public, anon;
grant execute on function public.learning_progress(uuid, uuid) to authenticated;

-- How many practice questions the bank can serve, per unit / topic / difficulty.
create function public.practice_bank_counts(p_student_id uuid)
returns table (subject_id uuid, unit_id uuid, topic_id uuid, difficulty text, available int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inst uuid := app.learning_own_student_institution(p_student_id);
begin
  return query
    select q.subject_id, q.curriculum_unit_id, q.curriculum_topic_id, q.difficulty, count(*)::int
    from app.practice_pool(v_inst, p_student_id) q
    group by q.subject_id, q.curriculum_unit_id, q.curriculum_topic_id, q.difficulty;
end;
$$;

revoke execute on function public.practice_bank_counts(uuid) from public, anon;
grant execute on function public.practice_bank_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Mastery: released online-test results join marks and submissions.
-- ---------------------------------------------------------------------------

alter table public.mastery_snapshots
  add column test_count int not null default 0 constraint mastery_snapshots_test_count_check check (test_count >= 0);
alter table public.mastery_snapshots drop constraint mastery_snapshots_check;
alter table public.mastery_snapshots
  add constraint mastery_snapshots_evidence_count_check check (mark_count + submission_count + test_count >= 1);

-- Same body as 0111 plus the 'test' observations (one per attempt and unit,
-- weight 1). Definer (was invoker) only to read the frozen test items through
-- app.learning_obs; execute stays service_role only.
create or replace function public.compute_mastery(
  p_institution_id uuid,
  p_class_section_id uuid default null,
  p_run_at timestamptz default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year_id uuid;
  v_run_at timestamptz := coalesce(p_run_at, now());
  v_count int;
begin
  select id into v_year_id
  from public.academic_years
  where institution_id = p_institution_id and is_current;

  if v_year_id is null then
    return 0;
  end if;

  with observations as (
    select
      m.student_id,
      cu.id as curriculum_unit_id,
      cu.subject_id,
      least(1, greatest(0, m.marks_obtained / ep.max_marks)) as s,
      2 as w,
      'mark'::text as src,
      m.id as src_id,
      coalesce(ep.held_on, ex.published_at::date) as on_date
    from public.marks m
    join public.exam_papers ep on ep.id = m.exam_paper_id and ep.institution_id = p_institution_id
    join public.exams ex on ex.id = ep.exam_id and ex.institution_id = p_institution_id
    join lateral unnest(ep.unit_ids) as unit_id(id) on true
    join public.curriculum_units cu on cu.id = unit_id.id and cu.institution_id = p_institution_id
    where m.institution_id = p_institution_id
      and m.superseded_by is null
      and not m.is_absent
      and m.marks_obtained is not null
      and cardinality(ep.unit_ids) > 0
      and ex.status = 'published'
      and ex.academic_year_id = v_year_id

    union all

    select
      asu.student_id,
      cu.id as curriculum_unit_id,
      cu.subject_id,
      least(1, greatest(0, asu.score / asu.max_score)) as s,
      1 as w,
      'submission'::text as src,
      asu.id as src_id,
      asu.graded_at::date as on_date
    from public.assignment_submissions asu
    join public.assignments a on a.id = asu.assignment_id and a.institution_id = p_institution_id
    join public.curriculum_units cu on cu.id = a.curriculum_unit_id and cu.institution_id = p_institution_id
    join public.class_sections cs on cs.id = a.class_section_id and cs.institution_id = p_institution_id
    where asu.institution_id = p_institution_id
      and asu.status = 'graded'
      and a.curriculum_unit_id is not null
      and cs.academic_year_id = v_year_id

    union all

    select
      o.student_id,
      cu.id as curriculum_unit_id,
      cu.subject_id,
      least(1, greatest(0, sum(greatest(o.awarded, 0)) / sum(o.marks))) as s,
      1 as w,
      'test'::text as src,
      o.source_id as src_id,
      max(o.on_date) as on_date
    from app.learning_obs(
      p_institution_id,
      case when p_class_section_id is null then null else app.learning_section_students(p_class_section_id) end,
      true
    ) o
    join public.curriculum_units cu on cu.id = o.unit_id and cu.institution_id = p_institution_id
    where o.source = 'test' and o.awarded is not null and o.marks > 0
    group by o.student_id, cu.id, cu.subject_id, o.source_id
  ),
  scoped as (
    select o.*, e.class_section_id
    from observations o
    join public.enrolments e
      on e.student_id = o.student_id
      and e.academic_year_id = v_year_id
      and e.status = 'active'
      and e.institution_id = p_institution_id
      and (p_class_section_id is null or e.class_section_id = p_class_section_id)
  ),
  ranked_evidence as (
    select
      scoped.*,
      row_number() over (
        partition by student_id, curriculum_unit_id
        order by on_date desc, src_id
      ) as rn
    from scoped
  ),
  aggregated as (
    select
      student_id,
      curriculum_unit_id,
      subject_id,
      class_section_id,
      round(sum(w * s) / sum(w), 3) as score,
      round(least(1, sum(w) / 4.0), 2) as confidence,
      count(*) filter (where src = 'mark') as mark_count,
      count(*) filter (where src = 'submission') as submission_count,
      count(*) filter (where src = 'test') as test_count,
      jsonb_agg(
        jsonb_build_object('src', src, 'id', src_id, 'score', round(s, 3), 'w', w, 'on', on_date)
        order by on_date desc, src_id
      ) filter (where rn <= 50) as evidence
    from ranked_evidence
    group by student_id, curriculum_unit_id, subject_id, class_section_id
  ),
  upserted as (
    insert into public.mastery_snapshots (
      institution_id, academic_year_id, student_id, class_section_id, subject_id, curriculum_unit_id,
      score, confidence, mark_count, submission_count, test_count, evidence, detector_version, computed_at
    )
    select
      p_institution_id, v_year_id, agg.student_id, agg.class_section_id, agg.subject_id, agg.curriculum_unit_id,
      agg.score, agg.confidence, agg.mark_count, agg.submission_count, agg.test_count, agg.evidence, 'mastery_v1', v_run_at
    from aggregated agg
    on conflict (academic_year_id, student_id, curriculum_unit_id) do update set
      institution_id = excluded.institution_id,
      class_section_id = excluded.class_section_id,
      subject_id = excluded.subject_id,
      score = excluded.score,
      confidence = excluded.confidence,
      mark_count = excluded.mark_count,
      submission_count = excluded.submission_count,
      test_count = excluded.test_count,
      evidence = excluded.evidence,
      detector_version = excluded.detector_version,
      computed_at = excluded.computed_at
    returning 1
  )
  select count(*) into v_count from upserted;

  if p_class_section_id is null then
    delete from public.mastery_snapshots
    where institution_id = p_institution_id
      and academic_year_id = v_year_id
      and computed_at < v_run_at;
  end if;

  return v_count;
end;
$$;

revoke execute on function public.compute_mastery(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.compute_mastery(uuid, uuid, timestamptz) to service_role;
