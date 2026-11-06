-- Student practice quizzes (Education OS redesign, Lane E).
-- practice_attempts is insert-once via public.submit_practice_attempt, which
-- recomputes score server-side from the answer keys inside `questions`
-- (the client never sends a score). Also public.my_upcoming_exam_papers: a
-- definer read, because students/guardians cannot read exams under RLS.
-- Helpers reused, not redefined: app.own_student_id (0001),
-- app.my_student_ids (0020), app.my_taught_student_ids (0025/0035),
-- app.my_institution_ids (0020).

create table public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  curriculum_unit_id uuid not null references public.curriculum_units (id),
  subject_id uuid not null references public.subjects (id),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and pg_column_size(questions) <= 65536),
  answers jsonb not null check (jsonb_typeof(answers) = 'array' and pg_column_size(answers) <= 4096),
  score int not null check (score >= 0),
  max_score int not null check (max_score between 1 and 15),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (score <= max_score)
);

create index practice_attempts_student_created_idx on public.practice_attempts (student_id, created_at desc);
create index practice_attempts_institution_subject_idx on public.practice_attempts (institution_id, subject_id);
create index practice_attempts_unit_idx on public.practice_attempts (curriculum_unit_id);

create trigger set_updated_at
before update on public.practice_attempts
for each row execute function app.set_updated_at();

-- Immutable after insert; insert only with the RPC's flag (lesson-5 bypass
-- for service_role / postgres so seed and demo reset still work).
create function app.guard_practice_attempts()
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
    raise exception 'code:forbidden' using detail = 'practice attempts are recorded only via submit_practice_attempt';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_practice_attempts() from public;

create trigger guard_practice_attempts
before insert or update or delete on public.practice_attempts
for each row execute function app.guard_practice_attempts();

alter table public.practice_attempts enable row level security;

revoke insert, update, delete on public.practice_attempts from anon, authenticated;

-- my_student_ids covers the student themself and linked guardians.
create policy practice_attempts_select on public.practice_attempts
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or student_id = any((select app.my_student_ids()))
    or student_id = any((select app.my_taught_student_ids()))
  );

-- ---------------------------------------------------------------------------
-- public.submit_practice_attempt
-- p_questions: [{ "stem": text, "options": [4 x text], "answerIndex": 0..3,
--                 "explanation"?: text }, ... 1..15]
-- p_answers:   [0..3 | null, ...] same length. Score = count of matches.
-- The answer key is supplied with the questions (generation is stateless), so
-- the score is server-computed but self-attested by the student; attempts
-- are practice, never marks.
-- ---------------------------------------------------------------------------

create function public.submit_practice_attempt(
  p_institution_id uuid,
  p_student_id uuid,
  p_curriculum_unit_id uuid,
  p_difficulty text,
  p_questions jsonb,
  p_answers jsonb
)
returns public.practice_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_section_id uuid;
  v_grade_id uuid;
  v_subject_id uuid;
  v_n int;
  v_score int := 0;
  v_i int;
  v_q jsonb;
  v_a jsonb;
  v_row public.practice_attempts;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.is_member(p_institution_id) then
    raise exception 'code:not_found' using detail = 'institution not found';
  end if;

  if not app.module_enabled(p_institution_id, 'practice') then
    raise exception 'code:forbidden' using detail = 'practice is not enabled for this school';
  end if;

  if p_student_id is distinct from app.own_student_id(p_institution_id) then
    raise exception 'code:forbidden' using detail = 'only the student may submit their own practice attempt';
  end if;

  if p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'code:validation_failed' using detail = 'difficulty must be easy, medium or hard';
  end if;

  select e.class_section_id, cs.grade_id into v_section_id, v_grade_id
  from public.enrolments e
  join public.class_sections cs on cs.id = e.class_section_id and cs.institution_id = e.institution_id
  where e.student_id = p_student_id and e.institution_id = p_institution_id and e.status = 'active'
  limit 1;

  if v_section_id is null then
    raise exception 'code:validation_failed' using detail = 'student has no active enrolment';
  end if;

  select cu.subject_id into v_subject_id
  from public.curriculum_units cu
  where cu.id = p_curriculum_unit_id
    and cu.institution_id = p_institution_id
    and cu.grade_id = v_grade_id
    and exists (
      select 1 from public.subject_assignments sa
      where sa.class_section_id = v_section_id and sa.subject_id = cu.subject_id
    );

  if v_subject_id is null then
    raise exception 'code:not_found' using detail = 'curriculum unit is not part of the student''s subjects';
  end if;

  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'code:validation_failed' using detail = 'questions and answers must be arrays';
  end if;

  v_n := jsonb_array_length(p_questions);
  if v_n not between 1 and 15 or jsonb_array_length(p_answers) <> v_n then
    raise exception 'code:validation_failed' using detail = '1-15 questions and one answer slot per question required';
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_q := p_questions -> v_i;
    v_a := p_answers -> v_i;

    if jsonb_typeof(v_q) is distinct from 'object'
      or jsonb_typeof(v_q -> 'stem') is distinct from 'string'
      or jsonb_typeof(v_q -> 'options') is distinct from 'array'
      or jsonb_array_length(v_q -> 'options') <> 4
      or jsonb_typeof(v_q -> 'answerIndex') is distinct from 'number'
      or (v_q ->> 'answerIndex') !~ '^[0-3]$'
    then
      raise exception 'code:validation_failed' using detail = format('question %s is malformed', v_i + 1);
    end if;

    if jsonb_typeof(v_a) = 'null' then
      continue;
    end if;
    if jsonb_typeof(v_a) is distinct from 'number' or (p_answers ->> v_i) !~ '^[0-3]$' then
      raise exception 'code:validation_failed' using detail = format('answer %s must be 0-3 or null', v_i + 1);
    end if;
    if (p_answers ->> v_i)::int = (v_q ->> 'answerIndex')::int then
      v_score := v_score + 1;
    end if;
  end loop;

  perform set_config('app.allow_practice_write', 'on', true);

  insert into public.practice_attempts (
    institution_id, student_id, curriculum_unit_id, subject_id, difficulty, questions, answers, score, max_score
  ) values (
    p_institution_id, p_student_id, p_curriculum_unit_id, v_subject_id, p_difficulty, p_questions, p_answers, v_score, v_n
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.submit_practice_attempt(uuid, uuid, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.submit_practice_attempt(uuid, uuid, uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- public.my_upcoming_exam_papers — callable by the student or a linked
-- guardian (app.my_student_ids). Papers of non-draft exams with a schedule
-- in the next p_days days, for the student's active section only.
-- ---------------------------------------------------------------------------

create function public.my_upcoming_exam_papers(p_student_id uuid, p_days int default 60)
returns table (
  exam_id uuid,
  exam_name text,
  paper_id uuid,
  subject_name text,
  scheduled_at timestamptz,
  duration_minutes int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_days is null or p_days not between 1 and 365 then
    raise exception 'code:validation_failed' using detail = 'p_days must be between 1 and 365';
  end if;

  if p_student_id is null or p_student_id <> all (array(select app.my_student_ids())) then
    return;
  end if;

  return query
    select ex.id, ex.name, ep.id, sub.name, ep.scheduled_at, ep.duration_minutes
    from public.students st
    join public.enrolments en
      on en.student_id = st.id and en.institution_id = st.institution_id and en.status = 'active'
    join public.exam_papers ep
      on ep.class_section_id = en.class_section_id and ep.institution_id = st.institution_id
    join public.exams ex on ex.id = ep.exam_id and ex.institution_id = ep.institution_id
    join public.subjects sub on sub.id = ep.subject_id
    where st.id = p_student_id
      and ep.scheduled_at is not null
      and ep.scheduled_at >= now()
      and ep.scheduled_at < now() + make_interval(days => p_days)
      and ex.status <> 'draft'
    order by ep.scheduled_at;
end;
$$;

revoke execute on function public.my_upcoming_exam_papers(uuid, int) from public, anon;
grant execute on function public.my_upcoming_exam_papers(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Module catalog (0084's table; insert only).
-- ---------------------------------------------------------------------------

insert into app.module_catalog (key, default_enabled) values ('practice', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;
