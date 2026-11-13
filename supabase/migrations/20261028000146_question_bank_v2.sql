-- 0146 — Question bank v2 (15-learning-exam-system-plan.md, Phase 1).
--
-- question_bank gains a review workflow, provenance and richer types:
--   status      draft | in_review | approved | rejected | archived
--   origin      manual | ai | import (ai_model only for ai)
--   explanation, marking_scheme, learning_outcome (competency is a tag here,
--               not a question type)
--   source_subject_textbook_id + source_chapter_no + source_page
--   version + parent_question_id   lineage: a duplicate points at its source
--   stem_question_id               a sub-question of a passage/case_based stem
--   answer_key  machine-checkable key for multi_select / fill_blank / match /
--               numerical; `answer` stays the readable answer for every type
--   reviewed_by/at, review_note
-- curriculum_topic_id is added by 0147 (the topics table is created there).
--
-- Review rules (owner brief: review is required only for AI and imports):
--   - manual questions may be saved straight as `approved`;
--   - origin ai/import may only be `approved` or `rejected` by a reviewer
--     (owner/principal/exam_controller = app.exam_write_roles(), the same
--     roles as the `question.approve` permission);
--   - an approved ai/import question is locked for non-reviewers: every
--     column except status (duplicate it to change it);
--   - reviewed_by/reviewed_at are stamped by the trigger, never the client,
--     and cleared when the status leaves approved/rejected (they name who
--     made the current review decision; audit_events keeps the history);
--   - the source textbook is one of the question's own grade+subject.
-- Enforced in app.question_bank_guard() below, so a direct PostgREST write
-- obeys the same rules as the actions. Service-role writes (seed, reset,
-- jobs) carry no user and skip the review rules.
--
-- is_active is kept for pre-v2 readers (paperDraft, practice): the trigger
-- holds is_active = (status = 'approved'). It is no longer client-writable;
-- a service-role write to is_active alone maps back to approved/archived.
--
-- question_collections (+ items): a staff member's own named sets of
-- questions, private or shared with the school (visibility = 'school').
--
-- public.question_bank_near_duplicates: pg_trgm similarity of candidate
-- bodies against the same grade+subject, under the caller's RLS. Warnings
-- only; nothing is blocked.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- question_bank columns
-- ---------------------------------------------------------------------------

alter table public.question_bank
  add constraint question_bank_id_institution_key unique (id, institution_id);

alter table public.question_bank
  add column status text not null default 'approved'
    constraint question_bank_status_check check (status in ('draft', 'in_review', 'approved', 'rejected', 'archived')),
  add column origin text not null default 'manual'
    constraint question_bank_origin_check check (origin in ('manual', 'ai', 'import')),
  add column ai_model text constraint question_bank_ai_model_check check (ai_model is null or char_length(ai_model) <= 120),
  add column explanation text constraint question_bank_explanation_check check (explanation is null or char_length(explanation) <= 4000),
  add column marking_scheme text constraint question_bank_marking_scheme_check check (marking_scheme is null or char_length(marking_scheme) <= 4000),
  add column learning_outcome text constraint question_bank_learning_outcome_check check (learning_outcome is null or char_length(learning_outcome) <= 300),
  add column answer_key jsonb,
  add column source_subject_textbook_id uuid,
  add column source_chapter_no smallint constraint question_bank_source_chapter_check check (source_chapter_no is null or source_chapter_no between 1 and 99),
  add column source_page int constraint question_bank_source_page_check check (source_page is null or source_page between 1 and 2000),
  add column version int not null default 1 constraint question_bank_version_check check (version >= 1),
  add column parent_question_id uuid,
  add column stem_question_id uuid,
  add column reviewed_by uuid references public.profiles (id),
  add column reviewed_at timestamptz,
  add column review_note text constraint question_bank_review_note_check check (review_note is null or char_length(review_note) <= 1000);

-- Composite FKs keep every link inside the row's institution. The self
-- references list the self column first: app.demo_reset nulls conkey[1].
alter table public.question_bank
  add constraint question_bank_source_textbook_fkey
    foreign key (source_subject_textbook_id, institution_id)
    references public.subject_textbooks (id, institution_id) on delete set null (source_subject_textbook_id),
  add constraint question_bank_parent_question_fkey
    foreign key (parent_question_id, institution_id)
    references public.question_bank (id, institution_id) on delete set null (parent_question_id),
  add constraint question_bank_stem_question_fkey
    foreign key (stem_question_id, institution_id)
    references public.question_bank (id, institution_id) on delete set null (stem_question_id),
  add constraint question_bank_ai_model_origin_check check (ai_model is null or origin = 'ai'),
  add constraint question_bank_source_page_needs_book_check check (
    source_subject_textbook_id is not null or (source_chapter_no is null and source_page is null)
  );

-- Backfill before the trigger exists: active -> approved, else archived.
update public.question_bank set status = case when is_active then 'approved' else 'archived' end;

-- Types: 9 new ones. Option/answer-key shape per type (cheap checks only;
-- the full rules, e.g. "answer is one of the options", are the Zod union in
-- src/modules/question-bank/schemas.ts).
alter table public.question_bank drop constraint question_bank_type_check;
alter table public.question_bank drop constraint question_bank_check;
alter table public.question_bank
  add constraint question_bank_type_check check (type in (
    'mcq', 'true_false', 'short_answer', 'long_answer',
    'multi_select', 'fill_blank', 'match', 'very_short_answer', 'case_based',
    'assertion_reason', 'numerical', 'passage', 'diagram'
  )),
  add constraint question_bank_options_shape_check check (coalesce(
    case
      when type = 'mcq' then jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6
      when type = 'multi_select' then jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8
      when type = 'match' then jsonb_typeof(options -> 'left') = 'array' and jsonb_typeof(options -> 'right') = 'array'
      when type = 'assertion_reason' then jsonb_typeof(options -> 'assertion') = 'string' and jsonb_typeof(options -> 'reason') = 'string'
      else options is null
    end, false)),
  add constraint question_bank_answer_key_shape_check check (coalesce(
    case
      when type in ('multi_select', 'fill_blank', 'match') then jsonb_typeof(answer_key) = 'array' and jsonb_array_length(answer_key) >= 1
      when type = 'numerical' then jsonb_typeof(answer_key -> 'value') = 'number'
      else answer_key is null
    end, false)),
  add constraint question_bank_assertion_answer_check check (type <> 'assertion_reason' or answer in ('A', 'B', 'C', 'D'));

create index question_bank_status_idx on public.question_bank (institution_id, grade_id, subject_id, status);
create index question_bank_stem_idx on public.question_bank (stem_question_id) where stem_question_id is not null;

-- ---------------------------------------------------------------------------
-- app.question_bank_guard — status sync + review rules (see header)
-- ---------------------------------------------------------------------------

create function app.question_bank_guard()
returns trigger
language plpgsql
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
       and to_jsonb(new) - array['status', 'is_active', 'updated_at'] is distinct from to_jsonb(old) - array['status', 'is_active', 'updated_at'] then
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

create trigger question_bank_guard
before insert or update on public.question_bank
for each row execute function app.question_bank_guard();

-- Definer (0011 pattern): the seed writes question_bank as service_role, which
-- has no EXECUTE on app.current_user_id()/my_institution_ids(). Safe here: every
-- lookup above filters institution_id explicitly and the reviewer check keys on
-- auth.uid(), which a definer still sees.
alter function app.question_bank_guard() security definer;

-- Column grant: origin, ai_model, version, parent_question_id, reviewed_*,
-- is_active, institution_id, created_by are not client-updatable.
revoke update on public.question_bank from anon, authenticated;
grant update (
  subject_id, grade_id, curriculum_unit_id, type, difficulty, body, options, answer, marks,
  status, explanation, marking_scheme, learning_outcome, answer_key,
  source_subject_textbook_id, source_chapter_no, source_page, stem_question_id, review_note
) on public.question_bank to authenticated;

-- ---------------------------------------------------------------------------
-- Near-duplicate lookup (warnings only)
-- ---------------------------------------------------------------------------

-- shortcut: no trigram index; one grade+subject is a few hundred rows. Add a
-- GIN gin_trgm_ops index and the % operator if a bank grows past ~10k rows.
create function public.question_bank_near_duplicates(
  p_institution_id uuid,
  p_grade_id uuid,
  p_subject_id uuid,
  p_bodies text[],
  p_exclude_id uuid default null
)
returns table (input_index int, question_id uuid, body text, similarity real)
language sql
stable
security invoker
set search_path = ''
as $$
  select (b.ord - 1)::int, q.id, q.body, extensions.similarity(q.body, b.body)
  from unnest(p_bodies[1:500]) with ordinality as b(body, ord)
  join public.question_bank q
    on q.institution_id = p_institution_id
   and q.grade_id = p_grade_id
   and q.subject_id = p_subject_id
   and q.status <> 'archived'
   and (p_exclude_id is null or q.id <> p_exclude_id)
  where char_length(b.body) <= 4000 -- the body column's own cap; bounds the trigram work
    and extensions.similarity(q.body, b.body) >= 0.6
  order by 1, 4 desc
  limit 200;
$$;

revoke execute on function public.question_bank_near_duplicates(uuid, uuid, uuid, text[], uuid) from public, anon;
grant execute on function public.question_bank_near_duplicates(uuid, uuid, uuid, text[], uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- question_collections + question_collection_items
-- ---------------------------------------------------------------------------

create table public.question_collections (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  owner_id uuid not null references public.profiles (id) default app.current_user_id(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  visibility text not null default 'private' check (visibility in ('private', 'school')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_collections_id_institution_key unique (id, institution_id)
);

create index question_collections_owner_idx on public.question_collections (institution_id, owner_id);

create trigger set_updated_at
before update on public.question_collections
for each row execute function app.set_updated_at();

alter table public.question_collections enable row level security;

create policy question_collections_select on public.question_collections
  for select to authenticated
  using (
    question_collections.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller', 'teacher'])))
    and (question_collections.owner_id = (select app.current_user_id()) or question_collections.visibility = 'school')
  );

create policy question_collections_insert on public.question_collections
  for insert to authenticated
  with check (
    question_collections.owner_id = (select app.current_user_id())
    and question_collections.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller', 'teacher'])))
  );

create policy question_collections_update on public.question_collections
  for update to authenticated
  using (
    question_collections.owner_id = (select app.current_user_id())
    and question_collections.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller', 'teacher'])))
  )
  with check (
    question_collections.owner_id = (select app.current_user_id())
    and question_collections.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller', 'teacher'])))
  );

create policy question_collections_delete on public.question_collections
  for delete to authenticated
  using (
    question_collections.owner_id = (select app.current_user_id())
    and question_collections.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller', 'teacher'])))
  );

revoke all on public.question_collections from anon, authenticated;
grant select, insert, delete on public.question_collections to authenticated;
grant update (name, description, visibility) on public.question_collections to authenticated;
grant select, insert, update, delete on public.question_collections to service_role;

create table public.question_collection_items (
  collection_id uuid not null,
  question_id uuid not null,
  institution_id uuid not null references public.institutions (id),
  position int not null default 0 check (position between 0 and 10000),
  added_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection_id, question_id),
  foreign key (collection_id, institution_id) references public.question_collections (id, institution_id) on delete cascade,
  foreign key (question_id, institution_id) references public.question_bank (id, institution_id) on delete cascade
);

create index question_collection_items_question_idx on public.question_collection_items (question_id);

create trigger set_updated_at
before update on public.question_collection_items
for each row execute function app.set_updated_at();

alter table public.question_collection_items enable row level security;

-- Items follow their collection's visibility (the subquery runs under the
-- collections policy). Question text itself stays behind question_bank RLS.
create policy question_collection_items_select on public.question_collection_items
  for select to authenticated
  using (exists (
    select 1 from public.question_collections c
    where c.id = question_collection_items.collection_id
      and c.institution_id = question_collection_items.institution_id
  ));

create policy question_collection_items_insert on public.question_collection_items
  for insert to authenticated
  with check (
    question_collection_items.added_by = (select app.current_user_id())
    and exists (
      select 1 from public.question_collections c
      where c.id = question_collection_items.collection_id
        and c.institution_id = question_collection_items.institution_id
        and c.owner_id = (select app.current_user_id())
    )
    and exists (
      select 1 from public.question_bank q
      where q.id = question_collection_items.question_id
        and q.institution_id = question_collection_items.institution_id
    )
  );

create policy question_collection_items_delete on public.question_collection_items
  for delete to authenticated
  using (exists (
    select 1 from public.question_collections c
    where c.id = question_collection_items.collection_id
      and c.institution_id = question_collection_items.institution_id
      and c.owner_id = (select app.current_user_id())
  ));

revoke all on public.question_collection_items from anon, authenticated;
grant select, insert, delete on public.question_collection_items to authenticated;
grant select, insert, update, delete on public.question_collection_items to service_role;
