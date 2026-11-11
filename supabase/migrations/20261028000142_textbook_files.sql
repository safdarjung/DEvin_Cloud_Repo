-- 0142 — Textbook links and PDFs: a school's own link and an uploaded PDF on
-- a subject_textbooks row (NCERT-mapped or custom), beside the official NCERT
-- link, which is untouched.
--
-- Link  subject_textbooks.school_url (https only, same check as custom_url)
--       usable on NCERT rows. Custom rows keep using custom_url as their
--       link, so the source check constraint needs no change (it never named
--       the new column).
-- File  documents entity_type 'subject_textbook' (entity_id = the textbook
--       row), in the private tenant-docs bucket through the 0067 flow (the
--       0139 curriculum_material target is the model): request -> signed PUT
--       -> confirm (object exists, magic bytes) -> active. PDF only.
--         read   staff of the school; students of that grade+subject and
--                their guardians (the same people as class materials in
--                0139); leaders through 0071. Storage follows documents RLS.
--         write  owner/principal/admin, and a teacher assigned to that
--                (grade, subject). A restrictive guard binds every insert.
--         The textbook row must exist in the same institution, so a deleted
--         textbook's file is unreachable by RLS; the app also retires it
--         (status 'deleted') in the same action.
-- Size  Textbook PDFs may be up to 50 MB; every other kind stays at 10 MB:
--         documents.size_bytes check  10 MB, or 50 MB for 'subject_textbook'
--         bucket file_size_limit      50 MB (a bucket has one cap)
--         app.guard_document_object_size()  on pending -> active, for ALL
--           kinds: the stored object must exist and its real size must be
--           within its kind's cap (an oversize object can be stored while
--           pending but never activated, and a row with no object yet
--           cannot be activated early and filled later).
--         server-side request check   MAX_TEXTBOOK_FILE_BYTES (schemas.ts)
--
-- Functions
--   app.guard_document_object_size() (definer trigger): reads
--     storage.objects (its RLS reads documents, so a policy here would
--     recurse). Service role / postgres bypass, as in 0131.

-- ---------------------------------------------------------------------------
-- subject_textbooks.school_url
-- ---------------------------------------------------------------------------

alter table public.subject_textbooks
  add column school_url text check (
    school_url is null
    or (char_length(school_url) <= 2000 and school_url ~ '^https://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')
  );

grant update (school_url) on public.subject_textbooks to authenticated;

-- ---------------------------------------------------------------------------
-- documents: entity type, size cap
-- ---------------------------------------------------------------------------

alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents
  add constraint documents_entity_type_check
  check (entity_type in ('student', 'staff', 'application', 'submission', 'report', 'resource', 'curriculum_material', 'subject_textbook'));

alter table public.documents drop constraint documents_size_bytes_check;
alter table public.documents
  add constraint documents_size_bytes_check
  check (
    (size_bytes between 1 and 10485760)
    or (entity_type = 'subject_textbook' and size_bytes between 1 and 52428800)
  );

update storage.buckets set file_size_limit = 52428800 where id = 'tenant-docs';

-- Real object size must fit the cap of its kind before a document goes live.
create function app.guard_document_object_size()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_size bigint;
  size_cap bigint := 10485760;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  select (o.metadata ->> 'size')::bigint into stored_size
  from storage.objects o
  where o.bucket_id = 'tenant-docs' and o.name = new.path;

  if new.entity_type = 'subject_textbook' then
    size_cap := 52428800;
  end if;

  -- No object yet means no activation, for every kind: a signed upload URL
  -- outlives the pending row, so an early activation would skip this cap.
  -- Same code and detail as 0131's app.guard_resource_document_activate.
  if stored_size is null then
    raise exception 'code:invalid_state' using detail = 'no uploaded object found for this document';
  end if;

  if stored_size > size_cap then
    raise exception 'code:validation_failed' using detail = 'uploaded file is larger than allowed for this kind of document';
  end if;

  return new;
end;
$$;

revoke all on function app.guard_document_object_size() from public, anon, authenticated;

create trigger guard_document_object_size
before update on public.documents
for each row
when (old.status = 'pending' and new.status = 'active')
execute function app.guard_document_object_size();

-- Same SQL-side "object exists" check as resources and curriculum materials.
create trigger guard_subject_textbook_document_activate
before update on public.documents
for each row
when (old.entity_type = 'subject_textbook' and old.status = 'pending' and new.status = 'active')
execute function app.guard_resource_document_activate();

-- ---------------------------------------------------------------------------
-- documents policies for 'subject_textbook' (additive; 0071/0139 untouched)
-- ---------------------------------------------------------------------------

create policy documents_select_subject_textbook on public.documents
  for select to authenticated
  using (
    documents.entity_type = 'subject_textbook'
    and exists (
      select 1 from public.subject_textbooks t
      where t.id = documents.entity_id
        and t.institution_id = documents.institution_id
        and (
          documents.institution_id = any((select app.my_institution_ids(app.staff_roles())))
          or (t.grade_id, t.subject_id) in (select s.grade_id, s.subject_id from app.my_studied_grade_subjects() s)
        )
    )
  );

-- Narrows 0071's leader branch: a file is visible only while its textbook is.
create policy documents_subject_textbook_read_guard on public.documents
  as restrictive
  for select to authenticated
  using (
    documents.entity_type <> 'subject_textbook'
    or exists (
      select 1 from public.subject_textbooks t
      where t.id = documents.entity_id and t.institution_id = documents.institution_id
    )
  );

create policy documents_insert_subject_textbook on public.documents
  for insert to authenticated
  with check (
    documents.entity_type = 'subject_textbook'
    and documents.created_by = (select app.current_user_id())
    and documents.status = 'pending'
    and documents.path like documents.institution_id::text || '/subject_textbook/' || documents.entity_id::text || '/%'
  );

-- PDF only, and only by someone who may edit that textbook's mapping.
create policy documents_subject_textbook_write_guard on public.documents
  as restrictive
  for insert to authenticated
  with check (
    documents.entity_type <> 'subject_textbook'
    or (
      documents.mime = 'application/pdf'
      and exists (
        select 1 from public.subject_textbooks t
        where t.id = documents.entity_id
          and t.institution_id = documents.institution_id
          and (
            documents.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
            or (
              documents.institution_id = any((select app.my_institution_ids(array['teacher'])))
              and (t.grade_id, t.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
            )
          )
      )
    )
  );

-- Confirm and delete: the same people who may write.
create policy documents_update_subject_textbook on public.documents
  for update to authenticated
  using (
    documents.entity_type = 'subject_textbook'
    and exists (
      select 1 from public.subject_textbooks t
      where t.id = documents.entity_id
        and t.institution_id = documents.institution_id
        and (
          documents.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
          or (
            documents.institution_id = any((select app.my_institution_ids(array['teacher'])))
            and (t.grade_id, t.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
          )
        )
    )
  )
  with check (
    documents.entity_type = 'subject_textbook'
    and exists (
      select 1 from public.subject_textbooks t
      where t.id = documents.entity_id
        and t.institution_id = documents.institution_id
        and (
          documents.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
          or (
            documents.institution_id = any((select app.my_institution_ids(array['teacher'])))
            and (t.grade_id, t.subject_id) in (select g.grade_id, g.subject_id from app.my_taught_grade_subjects() g)
          )
        )
    )
  );
