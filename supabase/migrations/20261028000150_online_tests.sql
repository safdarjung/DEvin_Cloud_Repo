-- 0150 — Online tests (15-learning-exam-system-plan.md, Phase 4).
--
-- online_tests    a frozen question paper version (0149 question_paper_versions)
--                 given to class sections in a window: opens_at..closes_at,
--                 duration, attempt limit, shuffle, result and answer release
--                 policy, practice flag (practice never touches official marks)
-- test_attempts   one row per attempt; started_at is the server clock and
--                 deadline = least(started_at + duration, closes_at)
-- test_responses  one row per (attempt, question): autosave upsert, locked on
--                 submit; auto_marks (objective, SQL), ai_suggested_* (a
--                 suggestion only, rule 6), teacher_marks (a human's marks)
-- test_events     start / resume / focus_lost / submit / auto_submit (autosave is
--                 not logged, saved_at covers it; resume + focus_lost stop at
--                 500 events per attempt)
--
-- Answer keys never reach a student: students have no policy on
-- test_responses or question_paper_versions; they read questions only through
-- public.get_test_for_attempt (answer, answer_key, explanation, marking scheme
-- and source ids stripped) and results only through public.get_test_result,
-- which follows the test's release policy ('after_close' waits for the 30 s
-- grace and for every open attempt to end; only a practice test may release
-- results at close, an exam test waits for leadership to publish; with
-- show_answers 'never' a result carries totals only). Every write a student makes goes
-- through a definer function that checks owner, status and the server deadline
-- (+30 s grace for the network). An expired attempt is submitted lazily on the
-- next start/read/save/submit and by public.auto_submit_expired_test_attempts
-- (service role, every job runner tick).
--
-- Marking: app.mark_test_item scores objective answers on submit (mcq,
-- true_false, assertion_reason, multi_select and match all-or-nothing,
-- fill_blank case/space-insensitive with "|"-separated alternatives per blank,
-- numerical within the key's tolerance); a wrong attempted objective answer
-- costs the paper's negative_marking. app.score_test_attempt applies OR groups
-- (best of the alternatives) and choose_count (best N slots per section); the
-- total is floored at 0. Written answers wait for teacher_marks; an attempt
-- with none is evaluated on submit. Official marks reach the exam only through
-- public.enter_marks (pushToMarksEntry action), never from here.
--
-- Access: owner/principal/exam_controller see and run every test; a teacher
-- manages tests they created for the (grade, subject) pairs they teach and
-- reads and marks only the attempts of students enrolled in a section where
-- they teach the test's subject; students see
-- non-draft tests of their sections; guardians read a child's attempt only
-- once results are released.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.online_tests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  question_paper_id uuid not null,
  paper_version_no int not null check (paper_version_no >= 1),
  -- Copied from the paper by app.online_test_guard (RLS reads them).
  grade_id uuid not null references public.grades (id),
  subject_id uuid not null references public.subjects (id),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  section_ids uuid[] not null check (cardinality(section_ids) between 1 and 50),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  duration_minutes int not null check (duration_minutes between 1 and 600),
  max_attempts smallint not null default 1 check (max_attempts between 1 and 10),
  shuffle boolean not null default false,
  show_results text not null default 'after_publish' check (show_results in ('never', 'after_close', 'after_publish')),
  show_answers text not null default 'after_publish' check (show_answers in ('never', 'after_close', 'after_publish')),
  practice boolean not null default false,
  -- 'open' is accepted for parity with the plan; the window (opens_at..closes_at) decides availability.
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'open', 'closed', 'evaluating', 'published', 'cancelled')),
  created_by uuid not null references public.profiles (id) default app.current_user_id(),
  published_at timestamptz,
  -- Last pushToMarksEntry (public.record_online_test_push); teacher marks saved
  -- after it mean the official marks need a re-push.
  marks_pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint online_tests_id_institution_key unique (id, institution_id),
  constraint online_tests_window_check check (closes_at > opens_at),
  -- An exam test's results wait for leadership to publish.
  constraint online_tests_results_release_check check (practice or show_results <> 'after_close'),
  foreign key (question_paper_id, institution_id) references public.question_papers (id, institution_id),
  foreign key (question_paper_id, paper_version_no) references public.question_paper_versions (paper_id, version_no)
);

create index online_tests_scope_idx on public.online_tests (institution_id, grade_id, subject_id, status);
create index online_tests_sections_idx on public.online_tests using gin (section_ids);

create trigger set_updated_at
before update on public.online_tests
for each row execute function app.set_updated_at();

create table public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  test_id uuid not null,
  student_id uuid not null references public.students (id),
  attempt_no smallint not null check (attempt_no between 1 and 10),
  started_at timestamptz not null default now(),
  deadline timestamptz not null,
  submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'auto_submitted', 'evaluated')),
  client_info jsonb check (client_info is null or (jsonb_typeof(client_info) = 'object' and octet_length(client_info::text) <= 512)),
  objective_score numeric(7, 2),
  subjective_score numeric(7, 2),
  total_score numeric(7, 2),
  finalised_by uuid references public.profiles (id),
  finalised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_attempts_id_institution_key unique (id, institution_id),
  unique (test_id, student_id, attempt_no),
  foreign key (test_id, institution_id) references public.online_tests (id, institution_id)
);

-- One open attempt per student per test (a double start cannot fork).
create unique index test_attempts_one_open_idx on public.test_attempts (test_id, student_id) where status = 'in_progress';
create index test_attempts_open_deadline_idx on public.test_attempts (deadline) where status = 'in_progress';
create index test_attempts_student_idx on public.test_attempts (student_id);

create trigger set_updated_at
before update on public.test_attempts
for each row execute function app.set_updated_at();

create table public.test_responses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  attempt_id uuid not null,
  item_key uuid not null,
  answer jsonb check (answer is null or octet_length(answer::text) <= 8192),
  saved_at timestamptz not null default now(),
  flagged_for_review boolean not null default false,
  auto_marks numeric(6, 2),
  ai_suggested_marks numeric(6, 2),
  ai_feedback text check (ai_feedback is null or char_length(ai_feedback) <= 2000),
  ai_suggested_at timestamptz,
  teacher_marks numeric(6, 2) check (teacher_marks is null or teacher_marks >= 0),
  teacher_feedback text check (teacher_feedback is null or char_length(teacher_feedback) <= 2000),
  marked_by uuid references public.profiles (id),
  marked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, item_key),
  foreign key (attempt_id, institution_id) references public.test_attempts (id, institution_id) on delete cascade
);

create trigger set_updated_at
before update on public.test_responses
for each row execute function app.set_updated_at();

create table public.test_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  attempt_id uuid not null,
  kind text not null check (kind in ('start', 'save', 'resume', 'focus_lost', 'submit', 'auto_submit')),
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (attempt_id, institution_id) references public.test_attempts (id, institution_id) on delete cascade
);

create index test_events_attempt_idx on public.test_events (attempt_id, at);

create trigger set_updated_at
before update on public.test_events
for each row execute function app.set_updated_at();

create trigger test_events_immutable
before update or delete on public.test_events
for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- online_tests guard (invoker: reads the paper and sections under the
-- writer's own RLS). Status moves only through public.transition_online_test.
-- ---------------------------------------------------------------------------

create function app.online_test_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_paper public.question_papers;
begin
  if coalesce(current_setting('app.allow_reset', true), '') = 'on'
     or coalesce(current_setting('app.allow_online_test_transition', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft'
     and (new.question_paper_id, new.paper_version_no, new.section_ids, new.opens_at, new.duration_minutes,
          new.max_attempts, new.shuffle, new.practice)
         is distinct from
         (old.question_paper_id, old.paper_version_no, old.section_ids, old.opens_at, old.duration_minutes,
          old.max_attempts, old.shuffle, old.practice) then
    raise exception 'code:invalid_state' using detail = 'Once a test is scheduled only its title, closing time and release settings can change.';
  end if;
  -- A test past its closing time stays closed (no reopening after results may be out).
  if tg_op = 'UPDATE' and new.closes_at is distinct from old.closes_at
     and (old.status not in ('draft', 'scheduled', 'open') or old.closes_at <= now()) then
    raise exception 'code:invalid_state' using detail = 'This test has closed.';
  end if;

  if tg_op = 'INSERT'
     or (new.question_paper_id, new.paper_version_no, new.section_ids)
        is distinct from (old.question_paper_id, old.paper_version_no, old.section_ids) then
    select * into v_paper from public.question_papers p
    where p.id = new.question_paper_id and p.institution_id = new.institution_id;
    if v_paper.id is null then
      raise exception 'code:not_found' using detail = 'Paper not found among the papers you can use.';
    end if;
    if not exists (
      select 1 from public.question_paper_versions v
      where v.paper_id = new.question_paper_id and v.version_no = new.paper_version_no
    ) then
      raise exception 'code:validation_failed' using detail = 'Use an approved or published version of the paper.';
    end if;
    new.grade_id := v_paper.grade_id;
    new.subject_id := v_paper.subject_id;
    if (select count(distinct s) from unnest(new.section_ids) s) <> cardinality(new.section_ids) then
      raise exception 'code:validation_failed' using detail = 'A section is listed twice.';
    end if;
    if exists (
      select 1 from unnest(new.section_ids) s
      where not exists (
        select 1 from public.class_sections cs
        where cs.id = s and cs.institution_id = new.institution_id
          and cs.grade_id = v_paper.grade_id and cs.academic_year_id = v_paper.academic_year_id
      )
    ) then
      raise exception 'code:validation_failed' using detail = 'Every section must be in the paper''s class and year.';
    end if;
    if v_uid is not null
       and not app.has_role(new.institution_id, app.exam_write_roles())
       and exists (
         select 1 from unnest(new.section_ids) s
         where (s, v_paper.subject_id) not in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
       ) then
      raise exception 'code:forbidden' using detail = 'You can give a test only to sections you teach this subject in.';
    end if;
  end if;

  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := v_uid;
    new.status := 'draft';
    new.published_at := null;
  elsif (new.status, new.published_at, new.created_by) is distinct from (old.status, old.published_at, old.created_by) then
    raise exception 'code:forbidden' using detail = 'Use the test actions to change its status.';
  end if;
  return new;
end;
$$;

create trigger online_test_guard
before insert or update on public.online_tests
for each row execute function app.online_test_guard();

-- An earlier closing time also caps every open attempt's deadline (definer:
-- the editor has no write on attempts).
create function app.online_test_clamp_deadlines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.test_attempts set deadline = new.closes_at
  where test_id = new.id and status = 'in_progress' and deadline > new.closes_at;
  return null;
end;
$$;

revoke execute on function app.online_test_clamp_deadlines() from public;

create trigger online_test_clamp_deadlines
after update of closes_at on public.online_tests
for each row when (new.closes_at < old.closes_at)
execute function app.online_test_clamp_deadlines();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Test level: leadership, or a teacher of the test's subject in one of its
-- sections. Per-student reads and marks use app.can_mark_test_student.
create function app.can_mark_online_test(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.online_tests t
    where t.id = p_test_id
      and (
        t.institution_id in (select app.my_institution_ids(app.exam_write_roles()))
        or exists (
          select 1 from app.my_taught_section_subjects() m
          where m.subject_id = t.subject_id and m.class_section_id = any(t.section_ids)
        )
      )
  );
$$;

revoke execute on function app.can_mark_online_test(uuid) from public;
grant execute on function app.can_mark_online_test(uuid) to authenticated;

-- Leadership, or a teacher of the test's subject in the test section the
-- student is actively enrolled in.
create function app.can_mark_test_student(p_test_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.online_tests t
    where t.id = p_test_id
      and (
        t.institution_id in (select app.my_institution_ids(app.exam_write_roles()))
        or exists (
          select 1 from public.enrolments e
          join app.my_taught_section_subjects() m on m.class_section_id = e.class_section_id and m.subject_id = t.subject_id
          where e.student_id = p_student_id and e.institution_id = t.institution_id
            and e.status = 'active' and e.class_section_id = any(t.section_ids)
        )
      )
  );
$$;

revoke execute on function app.can_mark_test_student(uuid, uuid) from public;
grant execute on function app.can_mark_test_student(uuid, uuid) to authenticated;

-- p_what: 'results' or 'answers'. Never released for a draft or cancelled test.
-- 'after_close' waits out the 30 s save grace and every open attempt (an
-- answer must not reach anyone while someone can still write one).
create function app.online_test_released(p_test_id uuid, p_what text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case case when p_what = 'answers' then t.show_answers else t.show_results end
      when 'after_publish' then t.status = 'published'
      when 'after_close' then (
          t.status in ('closed', 'evaluating', 'published')
          or (t.status in ('scheduled', 'open') and t.closes_at + interval '30 seconds' <= now())
        )
        and not exists (select 1 from public.test_attempts a where a.test_id = t.id and a.status = 'in_progress')
      else false
    end
    from public.online_tests t where t.id = p_test_id
  ), false);
$$;

revoke execute on function app.online_test_released(uuid, text) from public;
grant execute on function app.online_test_released(uuid, text) to authenticated;

-- The frozen items of a test, in paper order. Internal (definer callers only).
create function app.online_test_items(p_test_id uuid)
returns table (section_no int, section jsonb, item_no int, item_key uuid, item jsonb)
language sql
stable
set search_path = ''
as $$
  select s.ord::int, s.sec - 'items', i.ord::int, (i.it ->> 'id')::uuid, i.it
  from public.online_tests t
  join public.question_paper_versions v on v.paper_id = t.question_paper_id and v.version_no = t.paper_version_no
  cross join lateral jsonb_array_elements(v.snapshot -> 'sections') with ordinality as s(sec, ord)
  cross join lateral jsonb_array_elements(s.sec -> 'items') with ordinality as i(it, ord)
  where t.id = p_test_id;
$$;

revoke execute on function app.online_test_items(uuid) from public;

create function app.is_objective_type(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in ('mcq', 'true_false', 'assertion_reason', 'multi_select', 'fill_blank', 'numerical', 'match');
$$;

revoke execute on function app.is_objective_type(text) from public;

-- Client-triggered events (resume, focus_lost): at most 500 per attempt.
create function app.log_capped_test_event(p_institution_id uuid, p_attempt_id uuid, p_kind text)
returns void
language sql
set search_path = ''
as $$
  insert into public.test_events (institution_id, attempt_id, kind)
  select p_institution_id, p_attempt_id, p_kind
  where (select count(*) from public.test_events e where e.attempt_id = p_attempt_id) < 500;
$$;

revoke execute on function app.log_capped_test_event(uuid, uuid, text) from public;

create function app.norm_answer(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

revoke execute on function app.norm_answer(text) from public;

create function app.has_answer(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and p <> 'null'::jsonb
    and not (jsonb_typeof(p) = 'string' and btrim(p #>> '{}') = '')
    and not (jsonb_typeof(p) = 'array' and not exists (
      select 1 from jsonb_array_elements(p) e where e <> 'null'::jsonb and btrim(e #>> '{}') <> ''
    ));
$$;

revoke execute on function app.has_answer(jsonb) from public;

-- Marks for one objective answer; null for a written (subjective) item.
-- Unanswered = 0; wrong = -negative; all-or-nothing (the 0146 keys carry no
-- partial-credit rule).
create function app.mark_test_item(p_item jsonb, p_answer jsonb, p_negative numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text := p_item ->> 'type';
  v_marks numeric := (p_item ->> 'marks')::numeric;
  v_key jsonb := p_item -> 'answer_key';
  v_correct boolean := false;
  v_text text;
begin
  if not app.is_objective_type(v_type) then
    return null;
  end if;
  if not app.has_answer(p_answer) then
    return 0;
  end if;

  if v_type in ('mcq', 'true_false', 'assertion_reason') then
    v_correct := jsonb_typeof(p_answer) = 'string' and app.norm_answer(p_answer #>> '{}') = app.norm_answer(p_item ->> 'answer');
  elsif v_type = 'multi_select' then
    if jsonb_typeof(p_answer) = 'array' and jsonb_typeof(v_key) = 'array' then
      v_correct := (select coalesce(array_agg(distinct app.norm_answer(x) order by app.norm_answer(x)), '{}') from jsonb_array_elements_text(p_answer) x)
                 = (select coalesce(array_agg(distinct app.norm_answer(x) order by app.norm_answer(x)), '{}') from jsonb_array_elements_text(v_key) x);
    end if;
  elsif v_type = 'fill_blank' then
    if jsonb_typeof(p_answer) = 'array' and jsonb_typeof(v_key) = 'array'
       and jsonb_array_length(p_answer) = jsonb_array_length(v_key) then
      v_correct := not exists (
        select 1 from jsonb_array_elements_text(v_key) with ordinality as k(val, n)
        where not (
          app.norm_answer(p_answer ->> (k.n::int - 1)) = any (
            select app.norm_answer(alt) from unnest(string_to_array(k.val, '|')) alt
          )
        )
      );
    end if;
  elsif v_type = 'numerical' then
    v_text := btrim(p_answer #>> '{}');
    if jsonb_typeof(p_answer) in ('number', 'string') and v_text ~ '^-?\d+(\.\d+)?$' and jsonb_typeof(v_key -> 'value') = 'number' then
      v_correct := abs(v_text::numeric - (v_key ->> 'value')::numeric) <= coalesce((v_key ->> 'tolerance')::numeric, 0) + 0.000000001;
    end if;
  elsif v_type = 'match' then
    v_correct := jsonb_typeof(p_answer) = 'array' and p_answer = v_key;
  end if;

  return case when v_correct then v_marks else -coalesce(p_negative, 0) end;
end;
$$;

revoke execute on function app.mark_test_item(jsonb, jsonb, numeric) from public;

-- Scores with OR groups (best alternative) and choose_count (best N slots).
-- pending = a written answer without teacher_marks.
create function app.score_test_attempt(p_attempt_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with a as (
    select test_id from public.test_attempts where id = p_attempt_id
  ),
  sc as (
    select it.section_no,
      nullif(it.section ->> 'choose_count', '')::int as choose_count,
      coalesce('g' || (it.item ->> 'choice_group'), it.item_key::text) as slot,
      it.item_key,
      app.is_objective_type(it.item ->> 'type') as obj,
      case when app.is_objective_type(it.item ->> 'type') then coalesce(r.auto_marks, 0) else coalesce(r.teacher_marks, 0) end as score,
      (not app.is_objective_type(it.item ->> 'type') and r.teacher_marks is null and app.has_answer(r.answer)) as pending
    from a
    cross join lateral app.online_test_items(a.test_id) it
    left join public.test_responses r on r.attempt_id = p_attempt_id and r.item_key = it.item_key
  ),
  best as (
    select distinct on (section_no, slot) * from sc order by section_no, slot, score desc, item_key
  ),
  ranked as (
    select *, row_number() over (partition by section_no order by score desc, slot) as rn from best
  ),
  counted as (
    select * from ranked where choose_count is null or rn <= choose_count
  )
  select jsonb_build_object(
    'objective', coalesce((select sum(score) from counted where obj), 0),
    'subjective', coalesce((select sum(score) from counted where not obj), 0),
    'total', greatest(0, coalesce((select sum(score) from counted), 0)),
    'pending', (select count(*) from sc where pending)
  );
$$;

revoke execute on function app.score_test_attempt(uuid) from public;

-- Locks an in-progress attempt: auto-marks objective answers, stores scores,
-- evaluates it at once when no written answer waits for a teacher.
create function app.finish_test_attempt(p_attempt_id uuid, p_auto boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.test_attempts;
  v_negative numeric;
  v_score jsonb;
begin
  select * into v_attempt from public.test_attempts where id = p_attempt_id for update;
  if v_attempt.id is null or v_attempt.status <> 'in_progress' then
    return;
  end if;

  select coalesce((v.snapshot -> 'paper' ->> 'negative_marking')::numeric, 0) into v_negative
  from public.online_tests t
  join public.question_paper_versions v on v.paper_id = t.question_paper_id and v.version_no = t.paper_version_no
  where t.id = v_attempt.test_id;

  update public.test_responses r
  set auto_marks = app.mark_test_item(it.item, r.answer, v_negative)
  from app.online_test_items(v_attempt.test_id) it
  where r.attempt_id = p_attempt_id and r.item_key = it.item_key;

  v_score := app.score_test_attempt(p_attempt_id);

  update public.test_attempts set
    status = case when (v_score ->> 'pending')::int = 0 then 'evaluated' when p_auto then 'auto_submitted' else 'submitted' end,
    submitted_at = now(),
    objective_score = (v_score ->> 'objective')::numeric,
    subjective_score = (v_score ->> 'subjective')::numeric,
    total_score = (v_score ->> 'total')::numeric,
    finalised_at = case when (v_score ->> 'pending')::int = 0 then now() end
  where id = p_attempt_id;

  insert into public.test_events (institution_id, attempt_id, kind)
  values (v_attempt.institution_id, p_attempt_id, case when p_auto then 'auto_submit' else 'submit' end);

  perform app.audit(
    v_attempt.institution_id, app.current_user_id(),
    case when p_auto then 'online_test.attempt.auto_submitted' else 'online_test.attempt.submitted' end,
    'test_attempt', p_attempt_id, null,
    jsonb_build_object('testId', v_attempt.test_id, 'studentId', v_attempt.student_id), null
  );
end;
$$;

revoke execute on function app.finish_test_attempt(uuid, boolean) from public;

-- Submits the attempt if it is past its deadline plus the 30 s network grace.
create function app.expire_test_attempt(p_attempt_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.test_attempts
    where id = p_attempt_id and status = 'in_progress' and now() > deadline + interval '30 seconds'
  ) then
    perform app.finish_test_attempt(p_attempt_id, true);
    return true;
  end if;
  return false;
end;
$$;

revoke execute on function app.expire_test_attempt(uuid) from public;

-- The caller's own attempt (student) or not_found.
create function app.own_test_attempt(p_attempt_id uuid)
returns public.test_attempts
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.test_attempts;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'Sign in required.';
  end if;
  select * into v_attempt from public.test_attempts where id = p_attempt_id;
  if v_attempt.id is null or v_attempt.student_id is distinct from app.own_student_id(v_attempt.institution_id) then
    raise exception 'code:not_found' using detail = 'Attempt not found.';
  end if;
  return v_attempt;
end;
$$;

revoke execute on function app.own_test_attempt(uuid) from public;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.online_tests enable row level security;
alter table public.test_attempts enable row level security;
alter table public.test_responses enable row level security;
alter table public.test_events enable row level security;

create policy online_tests_select on public.online_tests
  for select to authenticated
  using (
    online_tests.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or (online_tests.grade_id, online_tests.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
    or (
      online_tests.status not in ('draft', 'cancelled')
      and online_tests.section_ids && (select array_agg(s) from app.my_student_section_ids() s)
    )
  );

create policy online_tests_insert on public.online_tests
  for insert to authenticated
  with check (
    online_tests.created_by = (select app.current_user_id())
    and (
      online_tests.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
      or (online_tests.grade_id, online_tests.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
    )
  );

create policy online_tests_update on public.online_tests
  for update to authenticated
  using (
    online_tests.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or (
      online_tests.created_by = (select app.current_user_id())
      and (online_tests.grade_id, online_tests.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
    )
  )
  with check (
    online_tests.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or (
      online_tests.created_by = (select app.current_user_id())
      and (online_tests.grade_id, online_tests.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
    )
  );

-- Student: own attempt while in progress or once results are released (scores
-- stay hidden until then); guardian: a child's once released; staff: markers.
create policy test_attempts_select on public.test_attempts
  for select to authenticated
  using (
    test_attempts.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or app.can_mark_test_student(test_attempts.test_id, test_attempts.student_id)
    or (
      test_attempts.student_id = any((select app.my_student_ids()))
      and (
        (test_attempts.status = 'in_progress' and test_attempts.student_id = app.own_student_id(test_attempts.institution_id))
        or app.online_test_released(test_attempts.test_id, 'results')
      )
    )
  );

-- Markers only; students and guardians read answers through the definer functions.
create policy test_responses_select on public.test_responses
  for select to authenticated
  using (
    test_responses.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or exists (
      select 1 from public.test_attempts a
      where a.id = test_responses.attempt_id and app.can_mark_test_student(a.test_id, a.student_id)
    )
  );

create policy test_events_select on public.test_events
  for select to authenticated
  using (
    test_events.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or exists (
      select 1 from public.test_attempts a
      where a.id = test_events.attempt_id and app.can_mark_test_student(a.test_id, a.student_id)
    )
  );

revoke all on public.online_tests from anon, authenticated;
grant select, insert on public.online_tests to authenticated;
grant update (
  title, question_paper_id, paper_version_no, section_ids, opens_at, closes_at,
  duration_minutes, max_attempts, shuffle, show_results, show_answers, practice
) on public.online_tests to authenticated;
grant select, insert, update, delete on public.online_tests to service_role;

revoke all on public.test_attempts from anon, authenticated;
grant select on public.test_attempts to authenticated;
grant select, insert, update, delete on public.test_attempts to service_role;

revoke all on public.test_responses from anon, authenticated;
grant select on public.test_responses to authenticated;
grant select, insert, update, delete on public.test_responses to service_role;

revoke all on public.test_events from anon, authenticated;
grant select on public.test_events to authenticated;
grant select, insert, update, delete on public.test_events to service_role;

-- ---------------------------------------------------------------------------
-- public.transition_online_test — the only way status moves.
-- ---------------------------------------------------------------------------

create function public.transition_online_test(p_test_id uuid, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_test public.online_tests;
  v_leader boolean;
  v_left int;
  v_attempt uuid;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'Sign in required.';
  end if;
  select * into v_test from public.online_tests where id = p_test_id for update;
  if v_test.id is null or not app.is_member(v_test.institution_id) then
    raise exception 'code:not_found' using detail = 'Test not found.';
  end if;
  v_leader := app.has_role(v_test.institution_id, app.exam_write_roles());
  if not v_leader and not (
    v_test.created_by = v_uid
    and (v_test.grade_id, v_test.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
  ) then
    raise exception 'code:forbidden' using detail = 'Only the teacher who made this test or the exam office can change it.';
  end if;

  if p_to = 'scheduled' then
    if v_test.status <> 'draft' then
      raise exception 'code:invalid_state' using detail = 'Only a draft test can be scheduled.';
    end if;
    if v_test.closes_at <= now() then
      raise exception 'code:validation_failed' using detail = 'The closing time has already passed.';
    end if;
  elsif p_to = 'draft' then
    if v_test.status not in ('scheduled', 'open') then
      raise exception 'code:invalid_state' using detail = 'Only a scheduled test can go back to draft.';
    end if;
    if exists (select 1 from public.test_attempts a where a.test_id = p_test_id) then
      raise exception 'code:invalid_state' using detail = 'Students have already started this test. Close or cancel it instead.';
    end if;
  elsif p_to = 'closed' then
    if v_test.status not in ('scheduled', 'open') then
      raise exception 'code:invalid_state' using detail = 'Only a scheduled test can be closed.';
    end if;
  elsif p_to = 'published' then
    if not v_leader then
      raise exception 'code:forbidden' using detail = 'Only the owner, principal or exam controller can publish results.';
    end if;
    if not (v_test.status in ('closed', 'evaluating') or (v_test.status in ('scheduled', 'open') and v_test.closes_at <= now())) then
      raise exception 'code:invalid_state' using detail = 'Close the test before publishing results.';
    end if;
  elsif p_to = 'cancelled' then
    if v_test.status in ('published', 'cancelled') then
      raise exception 'code:invalid_state' using detail = format('A %s test cannot be cancelled.', v_test.status);
    end if;
  else
    raise exception 'code:validation_failed' using detail = 'Unknown test status.';
  end if;

  -- Closing, publishing or cancelling ends every open attempt now.
  if p_to in ('closed', 'published', 'cancelled') then
    for v_attempt in select a.id from public.test_attempts a where a.test_id = p_test_id and a.status = 'in_progress' loop
      perform app.finish_test_attempt(v_attempt, true);
    end loop;
  end if;
  if p_to = 'published' then
    select count(*) into v_left from public.test_attempts a where a.test_id = p_test_id and a.status <> 'evaluated';
    if v_left > 0 then
      raise exception 'code:invalid_state' using detail = format('Mark and finalise every attempt first (%s left).', v_left);
    end if;
  end if;

  perform set_config('app.allow_online_test_transition', 'on', true);
  update public.online_tests set
    status = p_to,
    closes_at = case when p_to = 'closed' then least(closes_at, greatest(now(), opens_at + interval '1 second')) else closes_at end,
    published_at = case when p_to = 'published' then now() else published_at end
  where id = p_test_id;
  perform set_config('app.allow_online_test_transition', 'off', true);

  perform app.audit(v_test.institution_id, v_uid, 'online_test.' || p_to, 'online_test', p_test_id,
    jsonb_build_object('status', v_test.status), jsonb_build_object('status', p_to), null);
  return jsonb_build_object('status', p_to);
end;
$$;

revoke execute on function public.transition_online_test(uuid, text) from public, anon;
grant execute on function public.transition_online_test(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Student functions
-- ---------------------------------------------------------------------------

create function public.start_test_attempt(p_test_id uuid, p_client_info jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test public.online_tests;
  v_student uuid;
  v_attempt public.test_attempts;
  v_used int;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'Sign in required.';
  end if;
  select * into v_test from public.online_tests where id = p_test_id;
  v_student := case when v_test.id is not null then app.own_student_id(v_test.institution_id) end;
  if v_student is null or v_test.status in ('draft', 'cancelled')
     or not exists (
       select 1 from public.enrolments e
       where e.student_id = v_student and e.institution_id = v_test.institution_id
         and e.status = 'active' and e.class_section_id = any(v_test.section_ids)
     ) then
    raise exception 'code:not_found' using detail = 'Test not found.';
  end if;
  if p_client_info is not null and (jsonb_typeof(p_client_info) <> 'object' or octet_length(p_client_info::text) > 512) then
    raise exception 'code:validation_failed' using detail = 'Client info is too large.';
  end if;

  -- Recovery: an open attempt resumes; an expired one is submitted first.
  select * into v_attempt from public.test_attempts
  where test_id = p_test_id and student_id = v_student and status = 'in_progress'
  for update;
  if v_attempt.id is not null and not app.expire_test_attempt(v_attempt.id) then
    perform app.log_capped_test_event(v_test.institution_id, v_attempt.id, 'resume');
    return jsonb_build_object('attemptId', v_attempt.id, 'deadline', v_attempt.deadline, 'serverNow', now(), 'resumed', true);
  end if;

  if v_test.status not in ('scheduled', 'open') or now() < v_test.opens_at or now() >= v_test.closes_at then
    raise exception 'code:invalid_state' using detail = 'This test is not open now.';
  end if;
  select count(*) into v_used from public.test_attempts where test_id = p_test_id and student_id = v_student;
  if v_used >= v_test.max_attempts then
    raise exception 'code:invalid_state' using detail = 'You have no attempts left for this test.';
  end if;

  insert into public.test_attempts (institution_id, test_id, student_id, attempt_no, started_at, deadline, client_info)
  values (
    v_test.institution_id, p_test_id, v_student, v_used + 1, now(),
    least(now() + make_interval(mins => v_test.duration_minutes), v_test.closes_at), p_client_info
  )
  returning * into v_attempt;
  insert into public.test_events (institution_id, attempt_id, kind) values (v_test.institution_id, v_attempt.id, 'start');
  perform app.audit(v_test.institution_id, app.current_user_id(), 'online_test.attempt.started', 'test_attempt', v_attempt.id,
    null, jsonb_build_object('testId', p_test_id, 'attemptNo', v_attempt.attempt_no), null);
  return jsonb_build_object('attemptId', v_attempt.id, 'deadline', v_attempt.deadline, 'serverNow', now(), 'resumed', false);
end;
$$;

revoke execute on function public.start_test_attempt(uuid, jsonb) from public, anon;
grant execute on function public.start_test_attempt(uuid, jsonb) to authenticated, service_role;

-- Questions without answer, answer_key, explanation, marking_scheme or source
-- ids; shuffled within each section per attempt when the test says so.
create function public.get_test_for_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.test_attempts := app.own_test_attempt(p_attempt_id);
  v_test public.online_tests;
  v_paper jsonb;
begin
  perform app.expire_test_attempt(p_attempt_id);
  select * into v_attempt from public.test_attempts where id = p_attempt_id;
  select * into v_test from public.online_tests where id = v_attempt.test_id;
  select v.snapshot -> 'paper' into v_paper from public.question_paper_versions v
  where v.paper_id = v_test.question_paper_id and v.version_no = v_test.paper_version_no;

  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', v_attempt.id, 'attemptNo', v_attempt.attempt_no, 'status', v_attempt.status,
      'startedAt', v_attempt.started_at, 'deadline', v_attempt.deadline, 'submittedAt', v_attempt.submitted_at, 'serverNow', now()
    ),
    'test', jsonb_build_object(
      'id', v_test.id, 'title', v_test.title, 'durationMinutes', v_test.duration_minutes,
      'totalMarks', (v_paper ->> 'total_marks')::numeric, 'negativeMarking', (v_paper ->> 'negative_marking')::numeric,
      'instructions', v_paper ->> 'instructions'
    ),
    'sections', coalesce((
      select jsonb_agg(sec order by section_no) from (
        select it.section_no, jsonb_build_object(
          'id', it.section ->> 'id', 'title', it.section ->> 'title', 'instructions', it.section ->> 'instructions',
          'chooseCount', (it.section ->> 'choose_count')::int,
          'items', jsonb_agg(jsonb_build_object(
            'key', it.item_key, 'type', it.item ->> 'type', 'body', it.item ->> 'body', 'options', it.item -> 'options',
            'marks', (it.item ->> 'marks')::numeric, 'choiceGroup', (it.item ->> 'choice_group')::int
          ) order by case when v_test.shuffle then md5(p_attempt_id::text || it.item_key::text) end, it.item_no)
        ) as sec
        from app.online_test_items(v_test.id) it
        group by it.section_no, it.section
      ) s
    ), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object('itemKey', r.item_key, 'answer', r.answer, 'flagged', r.flagged_for_review, 'savedAt', r.saved_at))
      from public.test_responses r where r.attempt_id = p_attempt_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_test_for_attempt(uuid) from public, anon;
grant execute on function public.get_test_for_attempt(uuid) to authenticated, service_role;

-- Autosave. Returns {status: 'saved'} or, past the deadline + grace,
-- {status: 'expired'} after submitting the attempt (no exception, so the
-- auto-submit is not rolled back).
create function public.save_test_response(p_attempt_id uuid, p_item_key uuid, p_answer jsonb, p_flagged boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.test_attempts := app.own_test_attempt(p_attempt_id);
  v_type text;
  v_ok boolean;
  v_saved timestamptz;
begin
  -- Lock against a concurrent submit, then re-read.
  select * into v_attempt from public.test_attempts where id = p_attempt_id for update;
  if v_attempt.status <> 'in_progress' then
    raise exception 'code:invalid_state' using detail = 'This attempt is already submitted.';
  end if;
  if app.expire_test_attempt(p_attempt_id) then
    return jsonb_build_object('status', 'expired');
  end if;
  if exists (select 1 from public.online_tests t where t.id = v_attempt.test_id and t.status = 'cancelled') then
    raise exception 'code:invalid_state' using detail = 'This test was cancelled.';
  end if;

  select it.item ->> 'type' into v_type from app.online_test_items(v_attempt.test_id) it where it.item_key = p_item_key;
  if v_type is null then
    raise exception 'code:validation_failed' using detail = 'That question is not in this test.';
  end if;
  if p_answer is not null and p_answer <> 'null'::jsonb then
    if octet_length(p_answer::text) > 8192 then
      raise exception 'code:validation_failed' using detail = 'The answer is too long.';
    end if;
    v_ok := case
      when v_type in ('multi_select', 'fill_blank', 'match') then jsonb_typeof(p_answer) = 'array' and jsonb_array_length(p_answer) <= 20
      when v_type = 'numerical' then jsonb_typeof(p_answer) in ('number', 'string')
      else jsonb_typeof(p_answer) = 'string'
    end;
    if not v_ok then
      raise exception 'code:validation_failed' using detail = 'The answer does not fit this question type.';
    end if;
  end if;

  insert into public.test_responses (institution_id, attempt_id, item_key, answer, flagged_for_review, saved_at)
  values (v_attempt.institution_id, p_attempt_id, p_item_key, nullif(p_answer, 'null'::jsonb), coalesce(p_flagged, false), now())
  on conflict (attempt_id, item_key) do update
    set answer = excluded.answer, flagged_for_review = excluded.flagged_for_review, saved_at = excluded.saved_at
  returning saved_at into v_saved;
  return jsonb_build_object('status', 'saved', 'savedAt', v_saved);
end;
$$;

revoke execute on function public.save_test_response(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_test_response(uuid, uuid, jsonb, boolean) to authenticated, service_role;

-- Idempotent: a repeat submit returns the same status and time.
create function public.submit_test_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.test_attempts := app.own_test_attempt(p_attempt_id);
begin
  if v_attempt.status = 'in_progress' and not app.expire_test_attempt(p_attempt_id) then
    perform app.finish_test_attempt(p_attempt_id, false);
  end if;
  select * into v_attempt from public.test_attempts where id = p_attempt_id;
  return jsonb_build_object('status', v_attempt.status, 'submittedAt', v_attempt.submitted_at);
end;
$$;

revoke execute on function public.submit_test_attempt(uuid) from public, anon;
grant execute on function public.submit_test_attempt(uuid) to authenticated, service_role;

create function public.log_test_focus_lost(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.test_attempts := app.own_test_attempt(p_attempt_id);
begin
  if v_attempt.status = 'in_progress' then
    perform app.log_capped_test_event(v_attempt.institution_id, p_attempt_id, 'focus_lost');
  end if;
end;
$$;

revoke execute on function public.log_test_focus_lost(uuid) from public, anon;
grant execute on function public.log_test_focus_lost(uuid) to authenticated, service_role;

-- The student's tests: one row per non-draft test of their sections.
create function public.my_online_tests(p_institution_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'testId', t.id, 'title', t.title, 'subjectId', t.subject_id, 'status', t.status,
    'opensAt', t.opens_at, 'closesAt', t.closes_at, 'durationMinutes', t.duration_minutes,
    'maxAttempts', t.max_attempts, 'practice', t.practice,
    'attemptsUsed', (select count(*) from public.test_attempts a where a.test_id = t.id and a.student_id = me.sid),
    'openAttemptId', (select a.id from public.test_attempts a where a.test_id = t.id and a.student_id = me.sid and a.status = 'in_progress'),
    'lastAttemptId', (select a.id from public.test_attempts a where a.test_id = t.id and a.student_id = me.sid order by a.attempt_no desc limit 1),
    'lastStatus', (select a.status from public.test_attempts a where a.test_id = t.id and a.student_id = me.sid order by a.attempt_no desc limit 1),
    'resultsReleased', app.online_test_released(t.id, 'results')
  ) order by t.opens_at desc), '[]'::jsonb)
  from (select app.own_student_id(p_institution_id) as sid) me
  join public.online_tests t on t.institution_id = p_institution_id
  where me.sid is not null
    and t.status not in ('draft', 'cancelled')
    and exists (
      select 1 from public.enrolments e
      where e.student_id = me.sid and e.status = 'active' and e.class_section_id = any(t.section_ids)
    );
$$;

revoke execute on function public.my_online_tests(uuid) from public, anon;
grant execute on function public.my_online_tests(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Marking (teacher scope or leadership)
-- ---------------------------------------------------------------------------

-- Loads a response for marking: caller may mark, attempt submitted, test not
-- published/cancelled, written (subjective) item. Returns the item snapshot.
create function app.response_for_marking(p_response_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.test_attempts;
  v_test public.online_tests;
  v_item jsonb;
  v_item_key uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'Sign in required.';
  end if;
  select a.* into v_attempt from public.test_attempts a
  join public.test_responses r on r.attempt_id = a.id
  where r.id = p_response_id;
  if v_attempt.id is null or not app.can_mark_test_student(v_attempt.test_id, v_attempt.student_id) then
    raise exception 'code:not_found' using detail = 'Answer not found among the tests you mark.';
  end if;
  select * into v_test from public.online_tests where id = v_attempt.test_id;
  if v_test.status in ('published', 'cancelled') then
    raise exception 'code:invalid_state' using detail = format('This test is %s; marks are locked.', v_test.status);
  end if;
  if v_attempt.status = 'in_progress' then
    raise exception 'code:invalid_state' using detail = 'The student has not submitted yet.';
  end if;
  select r.item_key into v_item_key from public.test_responses r where r.id = p_response_id;
  select it.item into v_item from app.online_test_items(v_test.id) it where it.item_key = v_item_key;
  if app.is_objective_type(v_item ->> 'type') then
    raise exception 'code:invalid_state' using detail = 'Objective answers are marked automatically.';
  end if;
  return jsonb_build_object('item', v_item, 'attemptId', v_attempt.id, 'testId', v_test.id, 'institutionId', v_test.institution_id, 'testStatus', v_test.status);
end;
$$;

revoke execute on function app.response_for_marking(uuid) from public;

create function public.save_test_marks(p_response_id uuid, p_marks numeric, p_feedback text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb := app.response_for_marking(p_response_id);
  v_attempt_id uuid := (v_ctx ->> 'attemptId')::uuid;
  v_score jsonb;
begin
  if p_marks is null or p_marks < 0 or p_marks > (v_ctx -> 'item' ->> 'marks')::numeric or p_marks <> round(p_marks, 2) then
    raise exception 'code:validation_failed' using detail = format('Marks must be between 0 and %s.', trim_scale((v_ctx -> 'item' ->> 'marks')::numeric));
  end if;
  if p_feedback is not null and char_length(p_feedback) > 2000 then
    raise exception 'code:validation_failed' using detail = 'Feedback is too long.';
  end if;

  update public.test_responses set
    teacher_marks = p_marks, teacher_feedback = nullif(btrim(p_feedback), ''),
    marked_by = app.current_user_id(), marked_at = now()
  where id = p_response_id;

  -- An evaluated attempt keeps its status; its totals follow the new marks.
  v_score := app.score_test_attempt(v_attempt_id);
  update public.test_attempts set
    objective_score = (v_score ->> 'objective')::numeric,
    subjective_score = (v_score ->> 'subjective')::numeric,
    total_score = (v_score ->> 'total')::numeric
  where id = v_attempt_id;

  if v_ctx ->> 'testStatus' = 'closed' then
    perform set_config('app.allow_online_test_transition', 'on', true);
    update public.online_tests set status = 'evaluating' where id = (v_ctx ->> 'testId')::uuid;
    perform set_config('app.allow_online_test_transition', 'off', true);
  end if;

  perform app.audit((v_ctx ->> 'institutionId')::uuid, app.current_user_id(), 'online_test.marks.saved', 'test_response', p_response_id,
    null, jsonb_build_object('attemptId', v_attempt_id, 'marks', p_marks), null);
  return jsonb_build_object('responseId', p_response_id, 'teacherMarks', p_marks, 'pending', (v_score ->> 'pending')::int);
end;
$$;

revoke execute on function public.save_test_marks(uuid, numeric, text) from public, anon;
grant execute on function public.save_test_marks(uuid, numeric, text) to authenticated, service_role;

-- Rule 6: writes ONLY the ai_suggested_* columns; teacher_marks never.
create function public.save_test_ai_suggestion(p_response_id uuid, p_marks numeric, p_feedback text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb := app.response_for_marking(p_response_id);
begin
  if p_marks is null or p_marks < 0 or p_marks > (v_ctx -> 'item' ->> 'marks')::numeric then
    raise exception 'code:validation_failed' using detail = 'Suggested marks are out of range.';
  end if;
  update public.test_responses set
    ai_suggested_marks = round(p_marks, 2), ai_feedback = left(p_feedback, 2000), ai_suggested_at = now()
  where id = p_response_id;
end;
$$;

revoke execute on function public.save_test_ai_suggestion(uuid, numeric, text) from public, anon;
grant execute on function public.save_test_ai_suggestion(uuid, numeric, text) to authenticated, service_role;

create function public.finalise_test_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.test_attempts;
  v_status text;
  v_score jsonb;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'Sign in required.';
  end if;
  select * into v_attempt from public.test_attempts where id = p_attempt_id for update;
  if v_attempt.id is null or not app.can_mark_test_student(v_attempt.test_id, v_attempt.student_id) then
    raise exception 'code:not_found' using detail = 'Attempt not found among the tests you mark.';
  end if;
  select status into v_status from public.online_tests where id = v_attempt.test_id;
  if v_status in ('published', 'cancelled') then
    raise exception 'code:invalid_state' using detail = format('This test is %s; marks are locked.', v_status);
  end if;
  if v_attempt.status = 'in_progress' then
    raise exception 'code:invalid_state' using detail = 'The student has not submitted yet.';
  end if;
  v_score := app.score_test_attempt(p_attempt_id);
  if (v_score ->> 'pending')::int > 0 then
    raise exception 'code:invalid_state' using detail = format('%s written answer(s) still need marks.', v_score ->> 'pending');
  end if;
  update public.test_attempts set
    status = 'evaluated',
    objective_score = (v_score ->> 'objective')::numeric,
    subjective_score = (v_score ->> 'subjective')::numeric,
    total_score = (v_score ->> 'total')::numeric,
    finalised_by = app.current_user_id(), finalised_at = now()
  where id = p_attempt_id;
  perform app.audit(v_attempt.institution_id, app.current_user_id(), 'online_test.attempt.finalised', 'test_attempt', p_attempt_id,
    null, jsonb_build_object('total', v_score -> 'total'), null);
  return jsonb_build_object('status', 'evaluated', 'objective', v_score -> 'objective', 'subjective', v_score -> 'subjective', 'total', v_score -> 'total');
end;
$$;

revoke execute on function public.finalise_test_attempt(uuid) from public, anon;
grant execute on function public.finalise_test_attempt(uuid) to authenticated, service_role;

-- Stamps marks_pushed_at after pushToMarksEntry wrote official marks through
-- public.enter_marks (which re-checks the caller per paper).
create function public.record_online_test_push(p_test_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test public.online_tests;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'Sign in required.';
  end if;
  select * into v_test from public.online_tests where id = p_test_id for update;
  if v_test.id is null or not app.can_mark_online_test(p_test_id) then
    raise exception 'code:not_found' using detail = 'Test not found.';
  end if;
  if v_test.practice then
    raise exception 'code:invalid_state' using detail = 'A practice test never feeds official marks.';
  end if;
  perform set_config('app.allow_online_test_transition', 'on', true);
  update public.online_tests set marks_pushed_at = now() where id = p_test_id;
  perform set_config('app.allow_online_test_transition', 'off', true);
  return now();
end;
$$;

revoke execute on function public.record_online_test_push(uuid) from public, anon;
grant execute on function public.record_online_test_push(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Results: student (own), guardian (child) per the release policy; markers always.
-- ---------------------------------------------------------------------------

create function public.get_test_result(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.test_attempts;
  v_test public.online_tests;
  v_staff boolean;
  v_answers boolean;
  v_final boolean;
  v_totals_only boolean;
  v_paper jsonb;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'Sign in required.';
  end if;
  select * into v_attempt from public.test_attempts where id = p_attempt_id;
  if v_attempt.id is null then
    raise exception 'code:not_found' using detail = 'Result not found.';
  end if;
  v_staff := app.can_mark_test_student(v_attempt.test_id, v_attempt.student_id);
  if not v_staff and not (v_attempt.student_id in (select app.my_student_ids())) then
    raise exception 'code:not_found' using detail = 'Result not found.';
  end if;
  -- Expire first: release is judged on the attempt as it stands now.
  perform app.expire_test_attempt(p_attempt_id);
  select * into v_attempt from public.test_attempts where id = p_attempt_id;
  if not v_staff and v_attempt.status = 'in_progress' then
    raise exception 'code:invalid_state' using detail = 'This attempt is still in progress.';
  end if;
  if not v_staff and not app.online_test_released(v_attempt.test_id, 'results') then
    raise exception 'code:invalid_state' using detail = 'Results for this test are not released yet.';
  end if;
  select * into v_test from public.online_tests where id = v_attempt.test_id;
  select v.snapshot -> 'paper' into v_paper from public.question_paper_versions v
  where v.paper_id = v_test.question_paper_id and v.version_no = v_test.paper_version_no;
  v_answers := v_staff or app.online_test_released(v_test.id, 'answers');
  v_final := v_staff or v_attempt.status = 'evaluated';
  -- show_answers 'never': per-item marks would reveal the key, so totals only.
  v_totals_only := not v_staff and v_test.show_answers = 'never';

  return jsonb_build_object(
    'attemptId', v_attempt.id, 'testId', v_test.id, 'title', v_test.title, 'studentId', v_attempt.student_id,
    'status', v_attempt.status, 'submittedAt', v_attempt.submitted_at,
    'totalMarks', (v_paper ->> 'total_marks')::numeric,
    'objectiveScore', v_attempt.objective_score,
    'subjectiveScore', case when v_final then v_attempt.subjective_score end,
    'totalScore', case when v_final then v_attempt.total_score end,
    'answersShown', v_answers,
    'items', case when v_totals_only then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', it.item_key, 'section', it.section ->> 'title', 'type', it.item ->> 'type', 'body', it.item ->> 'body',
        'options', it.item -> 'options', 'marks', (it.item ->> 'marks')::numeric, 'choiceGroup', (it.item ->> 'choice_group')::int,
        'answer', r.answer,
        'awarded', case when app.is_objective_type(it.item ->> 'type') then r.auto_marks else r.teacher_marks end,
        'correct', case when app.is_objective_type(it.item ->> 'type') and r.auto_marks is not null then r.auto_marks = (it.item ->> 'marks')::numeric end,
        'feedback', r.teacher_feedback,
        'correctAnswer', case when v_answers then coalesce(it.item -> 'answer_key', to_jsonb(it.item ->> 'answer')) end,
        'explanation', case when v_answers then it.item ->> 'explanation' end
      ) order by it.section_no, it.item_no)
      from app.online_test_items(v_test.id) it
      left join public.test_responses r on r.attempt_id = p_attempt_id and r.item_key = it.item_key
    ), '[]'::jsonb) end
  );
end;
$$;

revoke execute on function public.get_test_result(uuid) from public, anon;
grant execute on function public.get_test_result(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sweep (service role; the job runner calls it every tick).
-- ---------------------------------------------------------------------------

create function public.auto_submit_expired_test_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select a.id from public.test_attempts a
    where a.status = 'in_progress' and a.deadline + interval '30 seconds' < now()
    order by a.deadline
    limit 500
  loop
    perform app.finish_test_attempt(v_id, true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.auto_submit_expired_test_attempts() from public, anon, authenticated;
grant execute on function public.auto_submit_expired_test_attempts() to service_role;
