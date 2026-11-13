-- 0148 — Content extraction (15-learning-exam-system-plan.md Phase 2; D55).
--
-- A school-uploaded textbook PDF (0142: documents entity_type
-- 'subject_textbook') is read page by page into searchable chunks. Only books
-- whose rights_status (0147) is school_owned | licensed | open_licence are
-- read; NCERT rows are forced to link_only (0139 ruling), so an NCERT PDF is
-- never fetched or stored.
--
-- Tables
--   content_extractions  one run over one documents row of one textbook:
--                        queued -> running -> done | partial | failed.
--                        'partial' = some pages had no text layer and wait in
--                        needs_ocr_pages for OCR through the AI gateway
--                        (app action, user's own quota and AI policy).
--   content_chunks       the text: by page, long pages split ~1,500 chars at
--                        paragraph boundaries; chapter_no from headings.
--                        tsv = to_tsvector('simple', heading + body), GIN.
--                        An editor's correction keeps the first original_body.
--
-- Read (both tables): who can read the textbook's file (0142): staff of the
--   school, and students/guardians of that grade+subject; only while the
--   book's rights_status still allows storing its text.
-- Write: no direct insert/delete for authenticated. Runs and chunks are
--   written by the definer RPCs below and by the content.extract job
--   (service role). content_chunks UPDATE (heading, body) for leaders and the
--   grade+subject's teacher: the textbook file's writers (0142).
--
-- Functions
--   public.start_content_extraction(textbook)     definer, authenticated:
--     writer + rights + active file checks, new run, enqueue content.extract.
--   public.save_content_ocr_pages(run, pages, chunks)  definer, authenticated:
--     OCR'd pages from the app (gateway), only pages still waiting, only on
--     the book's newest reading of its active file, at most 100 chunks.
--   public.save_content_extraction(run, total, needs_ocr, chunks)  service
--     role only (job): replaces the book's chunks in one transaction.
--   Both saves re-check rights and the active file under row locks taken in
--   the order book -> file -> run (the triggers below lock in the same order).
--   public.search_content_chunks(...)              invoker: caller's RLS.
--   app.content_writer(...)                       definer helper, no grants.
--   Triggers: chunk edit bookkeeping; a retired/deleted textbook file, or a
--   book whose rights/ncert_code no longer allow storing text, drops the
--   chunks and fails the unfinished readings (definer).

-- ---------------------------------------------------------------------------
-- content_extractions
-- ---------------------------------------------------------------------------

create table public.content_extractions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  subject_textbook_id uuid not null,
  document_id uuid not null references public.documents (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'partial')),
  pages_total int check (pages_total is null or pages_total between 0 and 2000),
  pages_done int not null default 0 check (pages_done between 0 and 2000),
  pages_ocr int not null default 0 check (pages_ocr between 0 and 2000),
  needs_ocr_pages int[] not null default '{}' check (cardinality(needs_ocr_pages) <= 2000),
  error text check (error is null or char_length(error) <= 500),
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_extractions_id_institution_key unique (id, institution_id),
  constraint content_extractions_textbook_fkey foreign key (subject_textbook_id, institution_id)
    references public.subject_textbooks (id, institution_id) on delete cascade
);

create index content_extractions_textbook_idx on public.content_extractions (subject_textbook_id, created_at desc);
create index content_extractions_document_idx on public.content_extractions (document_id);
-- One live run per book.
create unique index content_extractions_one_live_idx on public.content_extractions (subject_textbook_id)
  where status in ('queued', 'running');

create trigger set_updated_at
before update on public.content_extractions
for each row execute function app.set_updated_at();

alter table public.content_extractions enable row level security;

create policy content_extractions_select on public.content_extractions
  for select to authenticated
  using (
    exists (
      select 1 from public.subject_textbooks t
      where t.id = content_extractions.subject_textbook_id
        and t.institution_id = content_extractions.institution_id
        and t.rights_status in ('school_owned', 'licensed', 'open_licence')
        and (
          content_extractions.institution_id = any((select app.my_institution_ids(app.staff_roles())))
          or (t.grade_id, t.subject_id) in (select s.grade_id, s.subject_id from app.my_studied_grade_subjects() s)
        )
    )
  );

revoke all on public.content_extractions from anon, authenticated;
grant select on public.content_extractions to authenticated;
grant select, insert, update, delete on public.content_extractions to service_role;

-- ---------------------------------------------------------------------------
-- content_chunks
-- ---------------------------------------------------------------------------

create table public.content_chunks (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  extraction_id uuid not null,
  subject_textbook_id uuid not null,
  chapter_no smallint check (chapter_no is null or chapter_no between 1 and 99),
  page_from int not null check (page_from between 1 and 2000),
  page_to int not null,
  heading text check (heading is null or char_length(heading) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  tsv tsvector generated always as (to_tsvector('simple', coalesce(heading, '') || ' ' || body)) stored,
  original_body text,
  edited_by uuid references public.profiles (id),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_chunks_page_range_check check (page_to between page_from and 2000),
  constraint content_chunks_extraction_fkey foreign key (extraction_id, institution_id)
    references public.content_extractions (id, institution_id) on delete cascade,
  constraint content_chunks_textbook_fkey foreign key (subject_textbook_id, institution_id)
    references public.subject_textbooks (id, institution_id) on delete cascade
);

create index content_chunks_tsv_idx on public.content_chunks using gin (tsv);
create index content_chunks_textbook_idx on public.content_chunks (subject_textbook_id, chapter_no, page_from);
create index content_chunks_extraction_idx on public.content_chunks (extraction_id, page_from);

create trigger set_updated_at
before update on public.content_chunks
for each row execute function app.set_updated_at();

-- A correction keeps the first extracted text and who changed it last.
create function app.content_chunks_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body or new.heading is distinct from old.heading then
    new.original_body := coalesce(old.original_body, old.body);
    new.edited_by := app.current_user_id();
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger content_chunks_edit
before update on public.content_chunks
for each row execute function app.content_chunks_edit();

alter table public.content_chunks enable row level security;

create policy content_chunks_select on public.content_chunks
  for select to authenticated
  using (
    exists (
      select 1 from public.subject_textbooks t
      where t.id = content_chunks.subject_textbook_id
        and t.institution_id = content_chunks.institution_id
        and t.rights_status in ('school_owned', 'licensed', 'open_licence')
        and (
          content_chunks.institution_id = any((select app.my_institution_ids(app.staff_roles())))
          or (t.grade_id, t.subject_id) in (select s.grade_id, s.subject_id from app.my_studied_grade_subjects() s)
        )
    )
  );

-- Same people who may write the textbook's file (0142).
create policy content_chunks_update on public.content_chunks
  for update to authenticated
  using (
    exists (
      select 1 from public.subject_textbooks t
      where t.id = content_chunks.subject_textbook_id
        and t.institution_id = content_chunks.institution_id
        and (
          content_chunks.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
          or (
            content_chunks.institution_id = any((select app.my_institution_ids(array['teacher'])))
            and (t.grade_id, t.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.subject_textbooks t
      where t.id = content_chunks.subject_textbook_id
        and t.institution_id = content_chunks.institution_id
        and (
          content_chunks.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
          or (
            content_chunks.institution_id = any((select app.my_institution_ids(array['teacher'])))
            and (t.grade_id, t.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
          )
        )
    )
  );

revoke all on public.content_chunks from anon, authenticated;
grant select on public.content_chunks to authenticated;
grant update (heading, body) on public.content_chunks to authenticated;
grant select, insert, update, delete on public.content_chunks to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Caller may write this book's content: leaders, or a teacher of its grade+subject.
create function app.content_writer(p_institution_id uuid, p_grade_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_role(p_institution_id, array['owner', 'principal', 'admin'])
    or (
      app.has_role(p_institution_id, array['teacher'])
      and (p_grade_id, p_subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
    );
$$;

revoke execute on function app.content_writer(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.start_content_extraction
-- ---------------------------------------------------------------------------

create function public.start_content_extraction(p_subject_textbook_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_book public.subject_textbooks;
  v_doc uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  -- The row lock serialises two starts of the same book.
  select * into v_book from public.subject_textbooks where id = p_subject_textbook_id for update;
  if v_book.id is null or not app.is_member(v_book.institution_id) then
    raise exception 'code:not_found' using detail = 'Book not found.';
  end if;

  if not app.content_writer(v_book.institution_id, v_book.grade_id, v_book.subject_id) then
    raise exception 'code:forbidden' using detail = 'You can only read books for subjects you teach.';
  end if;

  if v_book.ncert_code is not null or v_book.rights_status not in ('school_owned', 'licensed', 'open_licence') then
    raise exception 'code:invalid_state'
      using detail = 'This book''s rights status does not allow storing its text. Set it to school-owned, licensed or open licence first.';
  end if;

  select d.id into v_doc
  from public.documents d
  where d.entity_type = 'subject_textbook'
    and d.entity_id = v_book.id
    and d.institution_id = v_book.institution_id
    and d.status = 'active'
  order by d.created_at desc
  limit 1;
  if v_doc is null then
    raise exception 'code:invalid_state' using detail = 'Upload the book''s PDF first.';
  end if;

  if exists (
    select 1 from public.content_extractions e
    where e.subject_textbook_id = v_book.id and e.status in ('queued', 'running')
  ) then
    raise exception 'code:invalid_state' using detail = 'This book is already being read.';
  end if;

  insert into public.content_extractions (institution_id, subject_textbook_id, document_id, created_by)
  values (v_book.institution_id, v_book.id, v_doc, v_uid)
  returning id into v_id;

  perform app.enqueue_job(v_book.institution_id, 'content.extract', jsonb_build_object('extractionId', v_id), 'content.extract:' || v_id::text);

  perform app.audit(
    v_book.institution_id, v_uid, 'content.extraction.started', 'content_extraction', v_id,
    null, jsonb_build_object('subject_textbook_id', v_book.id, 'document_id', v_doc), null
  );

  return v_id;
end;
$$;

revoke execute on function public.start_content_extraction(uuid) from public, anon;
grant execute on function public.start_content_extraction(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.save_content_extraction — job only (service role)
-- ---------------------------------------------------------------------------

-- p_chunks: [{chapter_no, page_from, page_to, heading, body}]. Replaces every
-- chunk of the book (a rerun of the same job is idempotent). A run that is no
-- longer the book's newest is marked failed instead (it would wipe newer text).
create function public.save_content_extraction(p_extraction_id uuid, p_pages_total int, p_needs_ocr int[], p_chunks jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_run public.content_extractions;
  v_book public.subject_textbooks;
  v_ocr int := cardinality(coalesce(p_needs_ocr, '{}'));
begin
  -- Lock order book -> file -> run (as the rights and file triggers): a
  -- concurrent rights change or file removal waits for this save, or this save
  -- sees it.
  select * into v_book from public.subject_textbooks
  where id = (select e.subject_textbook_id from public.content_extractions e where e.id = p_extraction_id)
  for share;
  select * into v_run from public.content_extractions where id = p_extraction_id for update;
  if v_run.id is null then
    return;
  end if;

  if v_book.ncert_code is not null or v_book.rights_status not in ('school_owned', 'licensed', 'open_licence') then
    update public.content_extractions
    set status = 'failed', error = 'This book''s rights status does not allow storing its text.', finished_at = now()
    where id = v_run.id;
    return;
  end if;

  perform 1 from public.documents d where d.id = v_run.document_id and d.status = 'active' for share;
  if not found then
    update public.content_extractions
    set status = 'failed', error = 'The book''s PDF was removed or replaced.', finished_at = now()
    where id = v_run.id;
    return;
  end if;

  if exists (
    select 1 from public.content_extractions e
    where e.subject_textbook_id = v_run.subject_textbook_id and e.created_at > v_run.created_at
  ) then
    update public.content_extractions
    set status = 'failed', error = 'A newer reading of this book replaced this one.', finished_at = now()
    where id = v_run.id;
    return;
  end if;

  delete from public.content_chunks where subject_textbook_id = v_run.subject_textbook_id;

  insert into public.content_chunks (institution_id, extraction_id, subject_textbook_id, chapter_no, page_from, page_to, heading, body)
  select v_run.institution_id, v_run.id, v_run.subject_textbook_id, c.chapter_no, c.page_from, c.page_to, c.heading, c.body
  from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as c(chapter_no smallint, page_from int, page_to int, heading text, body text);

  update public.content_extractions
  set status = case when v_ocr = 0 then 'done' else 'partial' end,
      pages_total = p_pages_total,
      pages_done = p_pages_total - v_ocr,
      pages_ocr = 0,
      needs_ocr_pages = coalesce(p_needs_ocr, '{}'),
      error = null,
      finished_at = now()
  where id = v_run.id;
end;
$$;

revoke execute on function public.save_content_extraction(uuid, int, int[], jsonb) from public, anon, authenticated;
grant execute on function public.save_content_extraction(uuid, int, int[], jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- public.save_content_ocr_pages — OCR'd pages from the app (AI gateway)
-- ---------------------------------------------------------------------------

create function public.save_content_ocr_pages(p_extraction_id uuid, p_pages int[], p_chunks jsonb)
returns public.content_extractions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_run public.content_extractions;
  v_book public.subject_textbooks;
  v_left int[];
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  -- Lock order book -> file -> run, as save_content_extraction and the triggers.
  select * into v_book from public.subject_textbooks
  where id = (select e.subject_textbook_id from public.content_extractions e where e.id = p_extraction_id)
  for share;
  select * into v_run from public.content_extractions where id = p_extraction_id for update;
  if v_run.id is null or not app.is_member(v_run.institution_id) then
    raise exception 'code:not_found' using detail = 'Reading not found.';
  end if;

  if not app.content_writer(v_book.institution_id, v_book.grade_id, v_book.subject_id) then
    raise exception 'code:forbidden' using detail = 'You can only read books for subjects you teach.';
  end if;

  if v_book.ncert_code is not null or v_book.rights_status not in ('school_owned', 'licensed', 'open_licence') then
    raise exception 'code:invalid_state' using detail = 'This book''s rights status does not allow storing its text.';
  end if;

  perform 1 from public.documents d where d.id = v_run.document_id and d.status = 'active' for share;
  if not found then
    raise exception 'code:invalid_state' using detail = 'The book''s PDF was removed or replaced. Start a new reading.';
  end if;

  if exists (
    select 1 from public.content_extractions e
    where e.subject_textbook_id = v_run.subject_textbook_id and e.created_at > v_run.created_at
  ) then
    raise exception 'code:invalid_state' using detail = 'A newer reading of this book replaced this one.';
  end if;

  if v_run.status <> 'partial' then
    raise exception 'code:invalid_state' using detail = 'This reading has no pages waiting for OCR.';
  end if;

  if cardinality(coalesce(p_pages, '{}')) = 0 or not (p_pages <@ v_run.needs_ocr_pages)
    or cardinality(p_pages) <> (select count(distinct p) from unnest(p_pages) p) then
    raise exception 'code:validation_failed' using detail = 'Only pages waiting for OCR can be saved, each once.';
  end if;

  -- 5 pages per app batch, up to ~14 chunks per 20,000-char page.
  if jsonb_typeof(coalesce(p_chunks, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_chunks, '[]'::jsonb)) > 100 then
    raise exception 'code:validation_failed' using detail = 'Too many chunks in one OCR save.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as c(page_from int, page_to int)
    where c.page_from is null or c.page_to is null or not (c.page_from = any(p_pages)) or not (c.page_to = any(p_pages))
  ) then
    raise exception 'code:validation_failed' using detail = 'A chunk points outside the OCR''d pages.';
  end if;

  delete from public.content_chunks where extraction_id = v_run.id and page_from = any(p_pages);

  insert into public.content_chunks (institution_id, extraction_id, subject_textbook_id, chapter_no, page_from, page_to, heading, body)
  select v_run.institution_id, v_run.id, v_run.subject_textbook_id, c.chapter_no, c.page_from, c.page_to, c.heading, c.body
  from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as c(chapter_no smallint, page_from int, page_to int, heading text, body text);

  v_left := array(select p from unnest(v_run.needs_ocr_pages) p where not (p = any(p_pages)) order by p);

  update public.content_extractions
  set needs_ocr_pages = v_left,
      pages_ocr = pages_ocr + cardinality(p_pages),
      pages_done = pages_done + cardinality(p_pages),
      status = case when cardinality(v_left) = 0 then 'done' else 'partial' end,
      finished_at = now()
  where id = v_run.id
  returning * into v_run;

  perform app.audit(
    v_run.institution_id, v_uid, 'content.extraction.ocr', 'content_extraction', v_run.id,
    null, jsonb_build_object('pages', to_jsonb(p_pages), 'remaining', cardinality(v_left)), null
  );

  return v_run;
end;
$$;

revoke execute on function public.save_content_ocr_pages(uuid, int[], jsonb) from public, anon;
grant execute on function public.save_content_ocr_pages(uuid, int[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- public.search_content_chunks — invoker: the caller's RLS decides rows
-- ---------------------------------------------------------------------------

-- p_q null/blank: every chunk matching the filters, in page order (chapter
-- retrieval). Snippet highlights wrap matches in « » (plain text, no HTML).
create function public.search_content_chunks(
  p_institution_id uuid,
  p_q text default null,
  p_subject_textbook_id uuid default null,
  p_grade_id uuid default null,
  p_subject_id uuid default null,
  p_chapter_nos int[] default null,
  p_limit int default 20
)
returns table (
  id uuid,
  subject_textbook_id uuid,
  book_title text,
  chapter_no smallint,
  heading text,
  page_from int,
  page_to int,
  snippet text,
  body text,
  rank real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select case when nullif(btrim(p_q), '') is null then null else websearch_to_tsquery('simple', p_q) end as query
  )
  select
    c.id,
    c.subject_textbook_id,
    t.custom_title,
    c.chapter_no,
    c.heading,
    c.page_from,
    c.page_to,
    case
      when q.query is null then left(c.body, 240)
      else ts_headline('simple', c.body, q.query, 'StartSel=«, StopSel=», MaxWords=35, MinWords=12, MaxFragments=2')
    end,
    c.body,
    case when q.query is null then 0::real else ts_rank(c.tsv, q.query) end
  from public.content_chunks c
  join public.subject_textbooks t on t.id = c.subject_textbook_id and t.institution_id = c.institution_id
  cross join q
  where c.institution_id = p_institution_id
    and (q.query is null or c.tsv @@ q.query)
    and (p_subject_textbook_id is null or c.subject_textbook_id = p_subject_textbook_id)
    and (p_grade_id is null or t.grade_id = p_grade_id)
    and (p_subject_id is null or t.subject_id = p_subject_id)
    and (p_chapter_nos is null or c.chapter_no = any(p_chapter_nos))
  order by 10 desc, c.subject_textbook_id, c.page_from, c.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function public.search_content_chunks(uuid, text, uuid, uuid, uuid, int[], int) from public, anon;
grant execute on function public.search_content_chunks(uuid, text, uuid, uuid, uuid, int[], int) to authenticated;

-- ---------------------------------------------------------------------------
-- A textbook file that is retired (replaced/removed), or a book whose rights
-- no longer allow storing text, takes its text with it and fails its
-- readings. Definer: the person changing the file/book has no delete grant
-- on chunks.
-- ---------------------------------------------------------------------------

create function app.content_chunks_on_document_retire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.content_chunks c
  using public.content_extractions e
  where e.document_id = new.id and c.extraction_id = e.id;
  update public.content_extractions
  set status = 'failed', error = 'The book''s PDF was removed or replaced.', finished_at = now()
  where document_id = new.id and status <> 'failed';
  return new;
end;
$$;

revoke all on function app.content_chunks_on_document_retire() from public, anon, authenticated;

create trigger content_chunks_on_document_retire
after update of status on public.documents
for each row
when (new.entity_type = 'subject_textbook' and old.status is distinct from new.status and new.status = 'deleted')
execute function app.content_chunks_on_document_retire();

create function app.content_chunks_on_rights_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.content_chunks where subject_textbook_id = new.id;
  update public.content_extractions
  set status = 'failed', error = 'This book''s rights status does not allow storing its text.', finished_at = now()
  where subject_textbook_id = new.id and status <> 'failed';
  return new;
end;
$$;

revoke all on function app.content_chunks_on_rights_change() from public, anon, authenticated;

create trigger content_chunks_on_rights_change
after update of rights_status, ncert_code on public.subject_textbooks
for each row
when (new.ncert_code is not null or new.rights_status not in ('school_owned', 'licensed', 'open_licence'))
execute function app.content_chunks_on_rights_change();
