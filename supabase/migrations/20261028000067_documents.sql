-- M05-T2: documents table + RLS, private bucket `tenant-docs`, storage.objects
-- policies.
--
-- Ruling (M05-tasks.md header): object access is delegated to `documents`
-- RLS — storage.objects policies only check that a VISIBLE documents row
-- with that `path` exists in the right status. Because that `exists`
-- subquery is a plain (non-definer) select against public.documents, it is
-- itself filtered by documents_select — so "visible" falls out of RLS
-- composition for free; no separate helper, no service role.
--
-- documents_select (07 §2.2): owner/principal/admin see every row;
-- admissions sees student/application rows; any member sees a staff
-- document whose staff row is their own (staff.user_id); guardian/student
-- see student documents of app.my_student_ids(). `submission` has no
-- reader yet (M9) — only the owner/principal/admin branch reaches it.
-- Broad branches use the (select app.my_institution_ids(...)) InitPlan
-- helper (lesson 7); the staff-ownership branch is a single-row `exists`
-- (same cost shape as a primary-key lookup, not a per-row definer call).
--
-- documents_insert/update: owner/principal/admin any entity_type;
-- admissions only student/application. `entity_id` is a polymorphic FK (no
-- real FK constraint — the table it points to depends on entity_type), so
-- each branch's `with check` binds it to the SAME institution_id (lesson
-- 2) by checking the concrete owning table. `submission` has no backing
-- table yet (M9), so it gets no entity_id/institution cross-check here —
-- acceptable because only owner/principal/admin can insert that type at
-- all, and institution_id itself is still role-gated.
--
-- Immutability + status machine: `app.guard_documents_update` (security
-- invoker, DBT-45-safe — it is plpgsql with no table access, so there is
-- nothing for the planner to inline into a policy) blocks institution_id/
-- entity_type/entity_id/path/created_by/mime from ever changing, and only
-- allows status pending->active or active->deleted (never active->pending,
-- deleted->anything, lesson 5 service_role/postgres bypass included).

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  entity_type text not null check (entity_type in ('student', 'staff', 'application', 'submission')),
  entity_id uuid not null,
  kind text not null check (length(kind) between 1 and 60),
  file_name text not null check (length(file_name) between 1 and 200),
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'active', 'deleted')),
  created_by uuid not null references public.profiles (id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_institution_entity_idx on public.documents (institution_id, entity_type, entity_id);

create trigger set_updated_at
before update on public.documents
for each row execute function app.set_updated_at();

create function app.guard_documents_update()
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

  if new.institution_id is distinct from old.institution_id
    or new.entity_type is distinct from old.entity_type
    or new.entity_id is distinct from old.entity_id
    or new.path is distinct from old.path
    or new.created_by is distinct from old.created_by
    or new.mime is distinct from old.mime
  then
    raise exception 'code:forbidden' using detail = 'institution_id, entity_type, entity_id, path, created_by, mime never change';
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'pending' and new.status = 'active')
      or (old.status = 'active' and new.status = 'deleted')
    )
  then
    raise exception 'code:invalid_state' using detail = 'status only moves pending to active, or active to deleted';
  end if;

  -- Deletion stamps are server-set on active→deleted and frozen otherwise.
  if old.status = 'active' and new.status = 'deleted' then
    new.deleted_at := now();
    new.deleted_by := app.current_user_id();
  elsif new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by then
    raise exception 'code:forbidden' using detail = 'deleted_at and deleted_by are set only by deletion';
  end if;

  return new;
end;
$$;

create trigger guard_documents_update
before update on public.documents
for each row execute function app.guard_documents_update();

alter table public.documents enable row level security;

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
  );

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
  );

create policy documents_update on public.documents
  for update to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    or (
      entity_type in ('student', 'application')
      and app.has_role(institution_id, array['admissions'])
    )
  )
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    or (
      entity_type in ('student', 'application')
      and app.has_role(institution_id, array['admissions'])
    )
  );

-- ---------------------------------------------------------------------------
-- Bucket + storage.objects policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-docs', 'tenant-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy tenant_docs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tenant-docs'
    and exists (
      select 1 from public.documents d
      where d.path = storage.objects.name
        -- the uploader also sees their own pending object, so confirmUpload can check it exists
        and (d.status = 'active' or (d.status = 'pending' and d.created_by = app.current_user_id()))
    )
  );

create policy tenant_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tenant-docs'
    and exists (
      select 1 from public.documents d
      where d.path = storage.objects.name and d.status = 'pending' and d.created_by = app.current_user_id()
    )
  );
