-- T-023: websites, pages, page_versions, notices, events + public RLS +
-- app.publish_page (05 §2.8; 06 §W3; 07 §1 T5, §2.2 website.*, §4).
--
-- Every table here carries `institution_id` directly (rule 1), including
-- `page_versions` (not listed as an "essential column" in 05 §2.8's
-- dictionary row, but every tenant table gets it per CLAUDE.md rule 1 and
-- 05 §5 "every institution_id is indexed") so RLS never needs a join
-- through `pages`/`websites` for the authenticated path.
--
-- `pages.published_version_id` references `page_versions`, which itself
-- references `pages` — the circular FK is broken by creating `pages`
-- without that column, then adding it after `page_versions` exists.

create table public.websites (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  is_live boolean not null default false,
  theme jsonb,
  nav jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id)
);

create trigger set_updated_at
before update on public.websites
for each row execute function app.set_updated_at();

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  website_id uuid not null references public.websites (id),
  slug text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, slug)
);

create trigger set_updated_at
before update on public.pages
for each row execute function app.set_updated_at();

create table public.page_versions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  page_id uuid not null references public.pages (id),
  version_no int not null,
  blocks jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (page_id, version_no)
);

create index page_versions_institution_idx on public.page_versions (institution_id);

-- shortcut: no physical FK from published_version_id to page_versions.
-- page_versions.page_id already references pages; a reverse FK here would
-- make the two tables a structural cycle, which app.demo_reset's
-- topological delete (0001) cannot order and would raise
-- code:internal on every reset, not just ones touching website data.
-- Integrity instead comes from the sole writer: app.publish_page checks
-- the version belongs to the page before setting this column, and
-- guard_pages_published_version blocks every other writer from touching it.
alter table public.pages
  add column published_version_id uuid;

create index pages_published_version_idx on public.pages (published_version_id);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  title text not null,
  body text not null,
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  is_public boolean not null default false,
  audience jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notices_institution_publish_idx on public.notices (institution_id, publish_at desc);

create trigger set_updated_at
before update on public.notices
for each row execute function app.set_updated_at();

create table public.events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_institution_starts_idx on public.events (institution_id, starts_at);

create trigger set_updated_at
before update on public.events
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Immutability (05 §2.8, §6): page_versions is immutable except
-- `published_at`, stamped only by app.publish_page via
-- `set_config('app.allow_publish', 'on', true)` (transaction-local, same
-- shape as app.demo_reset's 'app.allow_reset'). DELETE is never allowed
-- outside a demo_reset. pages.published_version_id gets the same guard so
-- a website.edit-only caller (no website.publish) cannot "publish" by
-- writing that column directly over PostgREST, bypassing the audited
-- function entirely.
-- ---------------------------------------------------------------------------

create function app.block_page_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and current_setting('app.allow_publish', true) = 'on' then
    if new.institution_id is distinct from old.institution_id
      or new.page_id is distinct from old.page_id
      or new.version_no is distinct from old.version_no
      or new.blocks is distinct from old.blocks
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception 'code:invalid_state' using detail = 'app.publish_page may only set published_at on page_versions';
    end if;
    return new;
  end if;

  raise exception 'code:invalid_state' using detail = format(
    '%s on %I.%I is not allowed; this table is immutable history',
    tg_op, tg_table_schema, tg_table_name
  );
end;
$$;

create trigger block_page_version_mutation
before update or delete on public.page_versions
for each row execute function app.block_page_version_mutation();

create function app.guard_pages_published_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return new;
  end if;

  if new.published_version_id is distinct from old.published_version_id
    and current_setting('app.allow_publish', true) <> 'on'
  then
    raise exception 'code:forbidden' using detail = 'pages.published_version_id may only change via app.publish_page';
  end if;

  return new;
end;
$$;

create trigger guard_published_version
before update on public.pages
for each row execute function app.guard_pages_published_version();

-- ---------------------------------------------------------------------------
-- RLS (05 §5 class P, 07 §2.2). Members (any active role) SELECT every row
-- of their institution, including drafts and unpublished notices/events —
-- the internal editor needs to see what isn't live yet. `website.edit`
-- (owner/principal/admin/admissions) INSERT/UPDATE; `website.publish`
-- (owner/principal/admin — admissions excluded, matrix row) is enforced
-- inside app.publish_page, not by a table policy. `anon` gets only the
-- published/live predicates (T5, C-80): no anon policy ever references a
-- draft page_versions row or a non-live website.
-- ---------------------------------------------------------------------------

alter table public.websites enable row level security;
alter table public.pages enable row level security;
alter table public.page_versions enable row level security;
alter table public.notices enable row level security;
alter table public.events enable row level security;

create policy websites_select on public.websites
  for select to authenticated
  using (app.is_member(institution_id));

create policy websites_write on public.websites
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy websites_update on public.websites
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy websites_anon_select on public.websites
  for select to anon
  using (is_live = true);

create policy pages_select on public.pages
  for select to authenticated
  using (app.is_member(institution_id));

create policy pages_insert on public.pages
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and exists (
      select 1 from public.websites w
      where w.id = pages.website_id and w.institution_id = pages.institution_id
    )
  );

create policy pages_update on public.pages
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and exists (
      select 1 from public.websites w
      where w.id = pages.website_id and w.institution_id = pages.institution_id
    )
  );

-- T5/C-80: a page is visible to anon only once it has a published version
-- AND its website is live — never a draft, never a page on an offline site.
create policy pages_anon_select on public.pages
  for select to anon
  using (
    published_version_id is not null
    and exists (
      select 1 from public.websites w
      where w.id = pages.website_id and w.is_live = true
    )
  );

create policy page_versions_select on public.page_versions
  for select to authenticated
  using (app.is_member(institution_id));

create policy page_versions_insert on public.page_versions
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and exists (
      select 1 from public.pages p
      where p.id = page_versions.page_id and p.institution_id = page_versions.institution_id
    )
  );
-- No UPDATE/DELETE policy: block_page_version_mutation blocks every
-- UPDATE/DELETE outside app.publish_page (security definer, bypasses RLS)
-- and demo_reset, so a policy here would be dead code.

-- T5/C-80: anon sees only the exact page_versions row a live page currently
-- publishes — never a sibling draft, even for the same page.
create policy page_versions_anon_select on public.page_versions
  for select to anon
  using (
    exists (
      select 1 from public.pages p
      join public.websites w on w.id = p.website_id
      where p.published_version_id = page_versions.id and w.is_live = true
    )
  );

create policy notices_select on public.notices
  for select to authenticated
  using (app.is_member(institution_id));

create policy notices_insert on public.notices
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy notices_update on public.notices
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy notices_anon_select on public.notices
  for select to anon
  using (is_public = true and publish_at <= now() and (expires_at is null or expires_at > now()));

create policy events_select on public.events
  for select to authenticated
  using (app.is_member(institution_id));

create policy events_insert on public.events
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy events_update on public.events
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy events_anon_select on public.events
  for select to anon
  using (is_public = true);

-- ---------------------------------------------------------------------------
-- app.publish_page (06 §W3, 07 §2.2 website.publish, §4). Core logic lives
-- in `app` (not exposed over PostgREST, same lesson as 0007's
-- submit_public_enquiry); `public.publish_page` below is the thin exposed
-- wrapper the T-025 editor action calls (same shape as 0012's
-- public.jobs_requeue wrapping a app-schema-adjacent check). Unlike
-- publish-exclusive admissions wrappers, this one IS meant for direct
-- `authenticated` RPC use — the caller's own role is checked inside, same
-- as jobs_requeue.
-- ---------------------------------------------------------------------------

create function app.publish_page(p_page_id uuid, p_version_id uuid)
returns public.pages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_page public.pages;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select institution_id into v_institution_id from public.pages where id = p_page_id;

  if v_institution_id is null then
    raise exception 'code:not_found' using detail = 'page not found';
  end if;

  if not app.has_role(v_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold website.publish for this institution';
  end if;

  if not exists (
    select 1 from public.page_versions v
    where v.id = p_version_id and v.page_id = p_page_id
  ) then
    raise exception 'code:validation_failed' using detail = 'version does not belong to this page';
  end if;

  perform set_config('app.allow_publish', 'on', true);

  update public.page_versions set published_at = now()
  where id = p_version_id and published_at is null;

  update public.pages set published_version_id = p_version_id
  where id = p_page_id
  returning * into v_page;

  perform app.audit(
    v_institution_id,
    app.current_user_id(),
    'website.page.published',
    'page',
    p_page_id,
    null,
    jsonb_build_object('version_id', p_version_id),
    null
  );

  return v_page;
end;
$$;

revoke execute on function app.publish_page(uuid, uuid) from public, anon, authenticated;

create function public.publish_page(p_page_id uuid, p_version_id uuid)
returns public.pages
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.publish_page(p_page_id, p_version_id);
end;
$$;

revoke execute on function public.publish_page(uuid, uuid) from public, anon;
grant execute on function public.publish_page(uuid, uuid) to authenticated;
