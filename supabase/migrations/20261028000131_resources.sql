-- Features-18 #23 (SPEC §A3): learning resource library (module key
-- `resources`, default enabled). Audience-by-section shape from 0122
-- (forms); teacher-owns-own-rows shape from 0126 (school labs).
--
-- Tables
--   resources          title, kind link/file/video/note, url (https only,
--                      <= 2000 chars), document_id -> documents (entity_type
--                      'resource', entity_id = this resource), subject_id,
--                      curriculum_unit_id (nullable; same subject),
--                      description, published, created_by.
--                      Source per kind (resources_kind_source_check):
--                        link, video -> url set, document_id null
--                        file        -> url null, document_id set (may be
--                                       null only while unpublished: the
--                                       document row needs the resource id
--                                       first, so upload happens after insert)
--                        note        -> url and document_id null, description set
--   resource_sections  audience rows (resource_id, class_section_id); no
--                      update (delete + insert).
--
-- documents (0067/0071/0077) gains entity_type 'resource'. Additive
-- policies only (0077 shape); 0071's documents_* policies are untouched:
--   documents_select_resource   attached file of a resource the caller can
--                               read (resources RLS composes), or any file
--                               of a resource the caller created
--   documents_insert_resource   resource managers: managers, or the teacher
--                               who created the resource; pending, path
--                               <institution>/resource/<resource id>/...
--   documents_update_resource   that teacher confirms/deletes own uploads
--                               (0067's guard keeps identity columns frozen)
--   app.guard_resource_document_activate() trigger (definer): a 'resource'
--                               document moves pending -> active only when
--                               its tenant-docs object exists (confirmUpload's
--                               check, so PostgREST cannot skip it)
--   documents_resource_guard    restrictive INSERT: a 'resource' row must
--                               name a resource of its own institution
--                               (0071's documents_insert lets managers insert
--                               any entity_type without that binding)
--
-- Functions
--   app.my_audience_resource_ids() -> setof uuid
--     RLS initPlan helper (0020 shape): resource ids whose audience includes
--     an active section of the caller's children / own enrolment. Lets the
--     resources policy avoid a sublink to resource_sections, so
--     resource_sections can compose its SELECT from resources RLS without a
--     policy recursion cycle.
--   app.guard_resources_write() trigger (definer, reads documents without
--     RLS so no resources <-> documents policy cycle): a non-null
--     document_id that is new or changed must be an active 'resource'
--     document of this resource in this institution.
--   No public RPCs: every write is a plain table write under RLS.
--
-- RLS matrix (M = owner, principal, admin; T = teacher; S = admissions,
-- accountant, exam_controller; G = guardian, student)
--   table              select                         insert          update          delete
--   resources          M all; S+T published;          M; T            M; T own        M; T own
--                      T own (any state); G published
--                      with an audience section of
--                      their child / own enrolment
--   resource_sections  rows of resources the caller   M; T own        none            M; T own
--                      can read                       resource and a
--                                                     section they teach
--   created_by = caller on insert for everyone; institution_id and
--   created_by are not in the UPDATE column grant. subject_id,
--   curriculum_unit_id, class_section_id are bound to the row's institution
--   in `with check`; resource_id by composite FK.
--
-- Seed notes (service role bypasses RLS, not the trigger or checks)
--   - resources.created_by defaults to app.current_user_id() (null under
--     service role) — seed must set it (a teacher's or manager's profile).
--   - Prefer link/video/note rows; a `file` row needs a documents row
--     (entity_type 'resource', entity_id = the resource, status 'active') and
--     a storage object, else seed it unpublished with document_id null.
--   - Teacher-created rows: audience sections the teacher teaches.
--
-- Reuses (never redefines): app.set_updated_at, app.current_user_id
-- (0001), app.my_institution_ids, app.my_taught_section_ids,
-- app.my_student_section_ids (0020), app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('resources', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- documents: entity type `resource` (list = 0077's + 'resource')
-- ---------------------------------------------------------------------------

alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents
  add constraint documents_entity_type_check
  check (entity_type in ('student', 'staff', 'application', 'submission', 'report', 'resource'));

-- ---------------------------------------------------------------------------
-- resources
-- ---------------------------------------------------------------------------

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  title text not null check (char_length(title) between 1 and 160),
  kind text not null check (kind in ('link', 'file', 'video', 'note')),
  url text check (
    url is null
    or (char_length(url) <= 2000 and url ~ '^https://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')
  ),
  document_id uuid references public.documents (id),
  subject_id uuid not null references public.subjects (id),
  curriculum_unit_id uuid references public.curriculum_units (id),
  description text check (description is null or char_length(description) between 1 and 2000),
  published boolean not null default false,
  created_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite-FK target for resource_sections.
  constraint resources_id_institution_key unique (id, institution_id),
  constraint resources_kind_source_check check (
    case kind
      when 'link' then url is not null and document_id is null
      when 'video' then url is not null and document_id is null
      when 'file' then url is null and (document_id is not null or not published)
      else url is null and document_id is null and description is not null
    end
  )
);

create index resources_institution_published_idx on public.resources (institution_id, published);
create index resources_created_by_idx on public.resources (created_by);
create index resources_subject_idx on public.resources (subject_id);
create index resources_curriculum_unit_idx on public.resources (curriculum_unit_id) where curriculum_unit_id is not null;
create index resources_document_idx on public.resources (document_id) where document_id is not null;

create trigger set_updated_at
before update on public.resources
for each row execute function app.set_updated_at();

create function app.guard_resources_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.document_id is not null
    and (tg_op = 'INSERT' or new.document_id is distinct from old.document_id)
    and not exists (
      select 1 from public.documents d
      where d.id = new.document_id
        and d.institution_id = new.institution_id
        and d.entity_type = 'resource'
        and d.entity_id = new.id
        and d.status = 'active'
    )
  then
    raise exception 'code:validation_failed' using detail = 'document must be an uploaded file of this resource';
  end if;

  return new;
end;
$$;

revoke all on function app.guard_resources_write() from public, anon, authenticated;

create trigger guard_resources_write
before insert or update on public.resources
for each row execute function app.guard_resources_write();

-- ---------------------------------------------------------------------------
-- resource_sections — audience rows
-- ---------------------------------------------------------------------------

create table public.resource_sections (
  resource_id uuid not null,
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (resource_id, class_section_id),
  constraint resource_sections_resource_fk foreign key (resource_id, institution_id)
    references public.resources (id, institution_id) on delete cascade
);

create index resource_sections_section_idx on public.resource_sections (class_section_id);
create index resource_sections_institution_idx on public.resource_sections (institution_id);

create trigger set_updated_at
before update on public.resource_sections
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- app.my_audience_resource_ids — RLS initPlan helper (lesson 7). Audience
-- ids only; the resources policy adds `published`.
-- ---------------------------------------------------------------------------

create function app.my_audience_resource_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rs.resource_id
  from public.resource_sections rs
  where rs.class_section_id = any(array(select app.my_student_section_ids()));
$$;

revoke execute on function app.my_audience_resource_ids() from public;
grant execute on function app.my_audience_resource_ids() to authenticated;
comment on function app.my_audience_resource_ids() is
  'RLS perf helper (P-01): resource ids whose audience includes an active section of app.my_student_ids() (guardian children / own enrolment). Called as (select app.my_audience_resource_ids()) inside the resources policy.';

-- ---------------------------------------------------------------------------
-- resources RLS
-- ---------------------------------------------------------------------------

alter table public.resources enable row level security;

create policy resources_select on public.resources
  for select to authenticated
  using (
    resources.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      resources.published
      and resources.institution_id = any((select app.my_institution_ids(array['admissions', 'accountant', 'exam_controller', 'teacher'])))
    )
    or (
      resources.created_by = (select app.current_user_id())
      and resources.institution_id = any((select app.my_institution_ids(array['teacher'])))
    )
    or (
      resources.published
      and resources.id = any((select app.my_audience_resource_ids()))
    )
  );

create policy resources_insert on public.resources
  for insert to authenticated
  with check (
    resources.created_by = (select app.current_user_id())
    and resources.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'teacher'])))
    and exists (
      select 1 from public.subjects su
      where su.id = resources.subject_id and su.institution_id = resources.institution_id
    )
    and (
      resources.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = resources.curriculum_unit_id
          and cu.institution_id = resources.institution_id
          and cu.subject_id = resources.subject_id
      )
    )
  );

-- Column grant below limits UPDATE to content columns + published.
create policy resources_update on public.resources
  for update to authenticated
  using (
    resources.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      resources.created_by = (select app.current_user_id())
      and resources.institution_id = any((select app.my_institution_ids(array['teacher'])))
    )
  )
  with check (
    (
      resources.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or (
        resources.created_by = (select app.current_user_id())
        and resources.institution_id = any((select app.my_institution_ids(array['teacher'])))
      )
    )
    and exists (
      select 1 from public.subjects su
      where su.id = resources.subject_id and su.institution_id = resources.institution_id
    )
    and (
      resources.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = resources.curriculum_unit_id
          and cu.institution_id = resources.institution_id
          and cu.subject_id = resources.subject_id
      )
    )
  );

create policy resources_delete on public.resources
  for delete to authenticated
  using (
    resources.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      resources.created_by = (select app.current_user_id())
      and resources.institution_id = any((select app.my_institution_ids(array['teacher'])))
    )
  );

revoke all on public.resources from anon, authenticated;
grant select, insert, delete on public.resources to authenticated;
grant update (title, kind, url, document_id, subject_id, curriculum_unit_id, description, published) on public.resources to authenticated;
grant select, insert, update, delete on public.resources to service_role;

-- ---------------------------------------------------------------------------
-- resource_sections RLS
-- ---------------------------------------------------------------------------

alter table public.resource_sections enable row level security;

-- Visible exactly when the parent resource is (resources RLS composes).
create policy resource_sections_select on public.resource_sections
  for select to authenticated
  using (
    exists (
      select 1 from public.resources r
      where r.id = resource_sections.resource_id
        and r.institution_id = resource_sections.institution_id
    )
  );

create policy resource_sections_insert on public.resource_sections
  for insert to authenticated
  with check (
    exists (
      select 1 from public.class_sections cs
      where cs.id = resource_sections.class_section_id
        and cs.institution_id = resource_sections.institution_id
    )
    and (
      resource_sections.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or (
        resource_sections.institution_id = any((select app.my_institution_ids(array['teacher'])))
        and resource_sections.class_section_id = any((select app.my_taught_section_ids()))
        and exists (
          select 1 from public.resources r
          where r.id = resource_sections.resource_id
            and r.institution_id = resource_sections.institution_id
            and r.created_by = (select app.current_user_id())
        )
      )
    )
  );

create policy resource_sections_delete on public.resource_sections
  for delete to authenticated
  using (
    resource_sections.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      resource_sections.institution_id = any((select app.my_institution_ids(array['teacher'])))
      and exists (
        select 1 from public.resources r
        where r.id = resource_sections.resource_id
          and r.institution_id = resource_sections.institution_id
          and r.created_by = (select app.current_user_id())
      )
    )
  );

revoke all on public.resource_sections from anon, authenticated;
grant select, insert, delete on public.resource_sections to authenticated;
grant select, insert, update, delete on public.resource_sections to service_role;

-- ---------------------------------------------------------------------------
-- documents policies for entity_type 'resource' (additive, 0077 shape)
-- ---------------------------------------------------------------------------

-- Readers see only the attached file; the creator sees every upload of
-- their resource (pending ones too, so confirm-upload can check them).
-- Managers already see every document through 0071's documents_select.
create policy documents_select_resource on public.documents
  for select to authenticated
  using (
    documents.entity_type = 'resource'
    and exists (
      select 1 from public.resources r
      where r.id = documents.entity_id
        and r.institution_id = documents.institution_id
        and (r.document_id = documents.id or r.created_by = (select app.current_user_id()))
    )
  );

create policy documents_insert_resource on public.documents
  for insert to authenticated
  with check (
    documents.entity_type = 'resource'
    and documents.created_by = (select app.current_user_id())
    and documents.status = 'pending'
    and documents.path like documents.institution_id::text || '/resource/' || documents.entity_id::text || '/%'
    and exists (
      select 1 from public.resources r
      where r.id = documents.entity_id
        and r.institution_id = documents.institution_id
        and (
          r.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
          or (
            r.institution_id = any((select app.my_institution_ids(array['teacher'])))
            and r.created_by = (select app.current_user_id())
          )
        )
    )
  );

create policy documents_update_resource on public.documents
  for update to authenticated
  using (
    documents.entity_type = 'resource'
    and documents.created_by = (select app.current_user_id())
    and exists (
      select 1 from public.resources r
      where r.id = documents.entity_id
        and r.institution_id = documents.institution_id
        and r.institution_id = any((select app.my_institution_ids(array['teacher'])))
        and r.created_by = (select app.current_user_id())
    )
  )
  with check (
    documents.entity_type = 'resource'
    and documents.created_by = (select app.current_user_id())
    and exists (
      select 1 from public.resources r
      where r.id = documents.entity_id
        and r.institution_id = documents.institution_id
        and r.institution_id = any((select app.my_institution_ids(array['teacher'])))
        and r.created_by = (select app.current_user_id())
    )
  );

create policy documents_resource_guard on public.documents
  as restrictive
  for insert to authenticated
  with check (
    documents.entity_type <> 'resource'
    or exists (
      select 1 from public.resources r
      where r.id = documents.entity_id and r.institution_id = documents.institution_id
    )
  );

-- A 'resource' document becomes active only when its uploaded object exists:
-- the check confirmUpload (src/modules/documents/actions.ts) makes in app code,
-- here enforced in SQL so a direct PostgREST update cannot skip it (0067's
-- guard allows pending -> active for any writer the update policy admits).
-- Definer: reads storage.objects without its RLS (that policy reads
-- documents, so a policy here would recurse). Service role / postgres bypass
-- (lesson 5) keeps seed and reset writes working.
create function app.guard_resource_document_activate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'tenant-docs' and o.name = new.path
  ) then
    raise exception 'code:invalid_state' using detail = 'no uploaded object found for this document';
  end if;

  return new;
end;
$$;

revoke all on function app.guard_resource_document_activate() from public, anon, authenticated;

create trigger guard_resource_document_activate
before update on public.documents
for each row
when (old.entity_type = 'resource' and old.status = 'pending' and new.status = 'active')
execute function app.guard_resource_document_activate();
