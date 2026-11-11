-- §H automated school setup (owner decision 2026-11-10: invite code, not open
-- signup). A stranger holding a code becomes the owner of a new tenant here,
-- so every rule is enforced inside SQL, not only in the /start route.
--
-- TABLES (platform-level, NOT tenant data: no `institution_id` column by
-- design, same as platform_leads 0100). RLS on, NO policies, all privileges
-- revoked from anon/authenticated; only service_role (scripts/invite-create.ts)
-- and the functions below touch them.
--   platform_invite_codes        one row per issued code. Only `code_hash` is
--                                stored, never the code. max_uses default 1,
--                                expires_at default now() + 30 days.
--                                email_hash (nullable) binds the code to the
--                                owner's email: only that email can redeem it.
--                                Null = unbound (invite-create.ts --unbound):
--                                whoever holds the code can claim any email.
--   platform_invite_redemptions  one row per institution created with a code
--                                (code, institution, user, created_at = when).
--   school_start_attempts        one row per /start request that passed the
--                                rate limit: client_hash (sha256 of the IP +
--                                daily salt, computed by the route, same as
--                                0100's source_ip_hash) and code_hash (same
--                                hash as code_hash below). Never a raw IP,
--                                email or code. Rows older than 1 hour are
--                                deleted by record_school_start_attempt.
--
-- CODE HASH CONTRACT (scripts/invite-create.ts must produce the same value):
--   code_hash = lowercase hex sha256 of the UTF-8 bytes of the code
--   node: createHash("sha256").update(code).digest("hex")
--   SQL hashes btrim(p_code) (spaces only), so the route sends code.trim().
--   Case-sensitive. Generate >= 128 bits of randomness with no whitespace:
--   a failed redeem rolls back and keeps no counter, so a signed-in PostgREST
--   caller of create_institution_with_invite bypasses the /start rate limit
--   (school_start_attempts); entropy is the defence there.
--
-- EMAIL HASH CONTRACT (same helper as the code hash):
--   email_hash = lowercase hex sha256 of lower(btrim(email))
--   node: createHash("sha256").update(email.trim().toLowerCase()).digest("hex")
--   (emails are ASCII after z.email(), so JS toLowerCase = SQL lower).
--   Binding exists because /start creates the account already confirmed (no
--   email delivery yet): without it a code holder could register an address
--   they do not own, and createUser's answer would reveal existing accounts.
--
-- FUNCTIONS
--   public.peek_platform_invite_code(p_code text, p_email text) returns boolean
--     service_role only (security invoker). /start calls it BEFORE creating
--     the auth user, so a wrong code or a wrong email leaves no account behind
--     and never reaches createUser. Same predicate as the redeem below; true =
--     redeemable right now by that email (can still lose a race). A wrong
--     email and a bad code are the same false.
--   public.record_school_start_attempt(p_client_hash text, p_code text) returns void
--     service_role only (security invoker). /start calls it before the peek.
--     Raises code:rate_limited when the client hash already has 5 attempts in
--     the last 15 minutes, or the code hash has 30 in the last hour (from any
--     client, so a leaked code cannot be hammered from many addresses);
--     otherwise records one attempt. A limited request records nothing.
--     Advisory xact locks (client hash, then code hash) serialise a parallel burst.
--   public.create_institution_with_invite(p_code text, p_name text, p_slug text)
--     returns table (institution_id uuid, slug text)
--     security definer, authenticated only, needs a signed-in user. A bound
--     code (email_hash set) must match the hash of the CALLER's own email,
--     read from auth.users for app.current_user_id() (never an argument).
--     Locks the code row FOR UPDATE with the validity predicate in the WHERE (READ
--     COMMITTED re-checks it after a concurrent redeem commits), then calls
--     public.create_institution (0064) unchanged, which validates name/slug
--     (format, 3-40 chars, its reserved list), applies the 3-owned-schools cap,
--     creates the institution, the caller's staff row + owner membership (its
--     own app.allow_membership_bootstrap bypass), the current academic year
--     with two default terms, and its audit row. The reserved-slug CHECK
--     institutions_slug_not_reserved (0101, re-added at the end of this file
--     with every top-level app route) is the authoritative reserved list; its
--     check_violation is mapped to validation_failed here. Then used_count+1
--     and one redemption row. Any error rolls everything back: the code is
--     not consumed and no school exists. One code use = one institution.
--   public.apply_school_template(p_institution_id uuid, p_template jsonb) returns jsonb
--     security definer, authenticated; the caller must be an ACTIVE OWNER of
--     that institution. Refuses when the school has any grade (idempotency
--     guard, serialised by an advisory xact lock). Validates the whole jsonb
--     (shape, counts, lengths, dates, times, money) while inserting; any
--     failure rolls the whole apply back. No trigger or guard is bypassed.
--     Returns {"academic_years":1,"terms":n,"grades":n,"class_sections":n,
--     "subjects":n,"periods":n,"fee_structures":n,"fee_components":n} and
--     writes audit action 'core.setup.template_applied' with those counts.
--
-- TEMPLATE JSONB (build in src/modules/core/setup/templates.ts). Unknown keys
-- are ignored. List order gives terms.sequence, grades.sort_key, periods.seq.
--   {
--     "academic_year": { "name": "2026-27", "starts_on": "2026-04-01", "ends_on": "2027-03-31" },
--     "terms": [                                              -- 1-4, inside the year, ordered, no overlap
--       { "name": "Term 1", "starts_on": "2026-04-01", "ends_on": "2026-09-30" },
--       { "name": "Term 2", "starts_on": "2026-10-01", "ends_on": "2027-03-31" }
--     ],
--     "grades": [                                             -- 1-15
--       { "code": "I", "display_name": "Grade I", "grade_group": "primary",
--         "sections": ["A", "B"],                             -- 1-8 names, 1-20 chars, unique per grade
--         "subjects": [                                       -- 0-15
--           { "code": "ENG", "name": "English", "kind": "language" },
--           { "code": "MATH", "name": "Mathematics", "kind": "scholastic" } ] }
--     ],
--     "periods": [                                            -- optional, 0-12, HH:MM 24h, ordered, no overlap
--       { "name": "Period 1", "starts_at": "08:00", "ends_at": "08:40" },
--       { "name": "Lunch", "starts_at": "11:20", "ends_at": "11:50", "is_break": true } ],
--     "fee_structure": {                                      -- optional
--       "name": "Standard fees 2026-27",
--       "components": [                                       -- 1-8, each head at most once
--         { "head": "tuition", "frequency": "monthly", "amount_paise": 250000 } ] }
--   }
--   Limits: whole template <= 100000 bytes. academic_year.name 1-20 chars;
--   dates YYYY-MM-DD in 2000-2100; year ends after it starts, span <= 400
--   days. term name 1-60. grade code 1-10 [A-Za-z0-9_-], display_name 1-60,
--   grade_group one of primary|middle|secondary|senior_secondary (the
--   settings grade_groups keys). subject code 1-20 [A-Za-z0-9_-], name 1-60,
--   kind one of scholastic|co_scholastic|skill|language. period name 1-30,
--   is_break optional boolean. fee name 1-120; head one of tuition|transport|
--   annual_charges|admission|exam|lab_computer|activity|caution_deposit;
--   frequency one of one_time|annual|term|quarterly|monthly; amount_paise an
--   integer 0-1000000000 (stored as rupees in fee_components.amount
--   numeric(12,2), exact).
--   What gets written:
--   - academic year: create_institution already made a current year + "Term
--     1"/"Term 2". That year is reused: its terms are deleted, its name/dates
--     set from the template, the template terms inserted (validate_term_dates
--     trigger still runs). If no current year exists, one is inserted.
--   - class_sections get capacity from the set_capacity trigger (settings
--     academic.max_section_size, else 40); no class teacher.
--   - subjects: NO grade-to-subject link table exists in the schema (checked
--     0005-0126; subject_assignments needs a teacher). Subjects are created
--     school-wide, deduplicated by code: an existing code is kept, and the
--     first occurrence in the template sets name/kind. The per-grade lists
--     are validated but not stored.
--   - periods are inserted only when the school has none (an existing bell
--     schedule is kept; count 0).
--   - fee_structures binds a structure to one grade, so "one fee structure"
--     = the same name and components on every template grade, is_default
--     false (draft). Nothing is assigned to any student.
--
-- ERROR CODES (message `code:<x>`, human text in DETAIL)
--   create_institution_with_invite: unauthenticated; forbidden ("invite code
--     is not valid": the ONE response for unknown, malformed, revoked,
--     expired and used-up codes and a code bound to another email, same
--     sqlstate P0001 and text); then, only
--     with a valid code: validation_failed (name/slug missing, name 2-120,
--     slug format/length, reserved slug), conflict (slug in use),
--     quota_exceeded (caller already owns 3 schools).
--   apply_school_template: unauthenticated; forbidden (not an active owner);
--     conflict (school already has grades, or the current year is already
--     used by other records); validation_failed (template shape; DETAIL names
--     the field, e.g. "grades[2].sections must have 1-8 items", 0-based).
--
-- STORAGE: bucket `school-branding` (public read, 1 MB, image/png|jpeg|webp,
-- no svg). One logo per school at `<institution_id>/logo.<png|jpg|jpeg|webp>`;
-- institutions.settings.branding.logo_path stores that path (core.setup.
-- saveBranding checks it), never a URL. storage.objects policies: select/
-- insert/update/delete only for an ACTIVE owner/principal/admin of the
-- institution named by the first path folder (select is needed by upsert and
-- remove; public reads go through the public endpoint, not these policies).
--
-- SEED / DEMO RESET: no seed rows; codes come only from scripts/invite-create.ts.
-- app.demo_reset (0001) and the C-01 generated RLS suite discover tenant
-- tables by an `institution_id` column; these two tables have none, so
-- demo_reset never touches them and no rls-expectations entry is needed.
-- Redemption FKs to institutions/profiles are ON DELETE SET NULL, so test
-- cleanup (delete institution, delete auth user) never blocks; the code row
-- keeps its used_count.
--
-- FOLLOW-UPS OUTSIDE THIS FILE: 07 §4 definer row for the four functions;
-- tests/security/grants.test.ts PUBLIC_AUTHENTICATED += create_institution_
-- with_invite, apply_school_template; SERVICE_ONLY += peek_platform_invite_code,
-- record_school_start_attempt. RESERVED_SLUGS (src/modules/core/schemas.ts)
-- equals the slug list at the end of this file (tests/unit/reserved-slugs.test.ts).
-- public.create_institution itself stays executable by `authenticated`
-- (0064, used by /api/v1/institutions and tests), so any signed-in user can
-- still create a school WITHOUT a code until that grant is revoked.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.platform_invite_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  note text check (note is null or char_length(note) <= 200),
  max_uses int not null default 1 check (max_uses between 1 and 1000),
  used_count int not null default 0,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (used_count between 0 and max_uses)
);

create trigger set_updated_at
before update on public.platform_invite_codes
for each row execute function app.set_updated_at();

alter table public.platform_invite_codes enable row level security;
revoke all on public.platform_invite_codes from anon, authenticated;

create table public.platform_invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_code_id uuid not null references public.platform_invite_codes (id),
  created_institution_id uuid unique references public.institutions (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index platform_invite_redemptions_code_idx on public.platform_invite_redemptions (invite_code_id);

create trigger set_updated_at
before update on public.platform_invite_redemptions
for each row execute function app.set_updated_at();

alter table public.platform_invite_redemptions enable row level security;
revoke all on public.platform_invite_redemptions from anon, authenticated;

create table public.school_start_attempts (
  id uuid primary key default gen_random_uuid(),
  client_hash text not null check (client_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index school_start_attempts_client_idx on public.school_start_attempts (client_hash, created_at);
create index school_start_attempts_code_idx on public.school_start_attempts (code_hash, created_at);
create index school_start_attempts_created_idx on public.school_start_attempts (created_at);

create trigger set_updated_at
before update on public.school_start_attempts
for each row execute function app.set_updated_at();

alter table public.school_start_attempts enable row level security;
revoke all on public.school_start_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invite code check (service role) and redeem (signed-in stranger)
-- ---------------------------------------------------------------------------

create function public.peek_platform_invite_code(p_code text, p_email text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_invite_codes c
    where char_length(p_code) <= 200
      and c.code_hash = encode(extensions.digest(btrim(p_code), 'sha256'), 'hex')
      and c.revoked_at is null
      and c.expires_at > now()
      and c.used_count < c.max_uses
      -- a null p_email never matches a bound code
      and (c.email_hash is null
        or c.email_hash = encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex'))
  );
$$;

revoke all on function public.peek_platform_invite_code(text, text) from public, anon, authenticated;
grant execute on function public.peek_platform_invite_code(text, text) to service_role;

create function public.record_school_start_attempt(p_client_hash text, p_code text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code_hash text;
begin
  if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$' or p_code is null or char_length(p_code) > 200 then
    raise exception 'code:validation_failed' using detail = 'client hash and code are required';
  end if;
  v_code_hash := encode(extensions.digest(btrim(p_code), 'sha256'), 'hex');

  -- Always client first, then code, so two callers never wait on each other in a cycle.
  perform pg_advisory_xact_lock(hashtext('school_start:client:' || p_client_hash));
  perform pg_advisory_xact_lock(hashtext('school_start:code:' || v_code_hash));

  delete from public.school_start_attempts a where a.created_at < now() - interval '1 hour';

  if (select count(*) from public.school_start_attempts a
      where a.client_hash = p_client_hash and a.created_at > now() - interval '15 minutes') >= 5
    or (select count(*) from public.school_start_attempts a
      where a.code_hash = v_code_hash and a.created_at > now() - interval '1 hour') >= 30
  then
    raise exception 'code:rate_limited' using detail = 'too many attempts; try again later';
  end if;

  insert into public.school_start_attempts (client_hash, code_hash) values (p_client_hash, v_code_hash);
end;
$$;

revoke all on function public.record_school_start_attempt(text, text) from public, anon, authenticated;
grant execute on function public.record_school_start_attempt(text, text) to service_role;

create function public.create_institution_with_invite(p_code text, p_name text, p_slug text)
returns table (institution_id uuid, slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_email_hash text;
  v_code public.platform_invite_codes;
  v_institution_id uuid;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  -- The caller's own email, never an argument (null email: no bound code matches).
  select encode(extensions.digest(lower(btrim(u.email)), 'sha256'), 'hex') into v_email_hash
  from auth.users u
  where u.id = v_uid;

  -- Validity lives in the WHERE so a concurrent redeem that commits first is
  -- re-checked on the locked row. Every failure below is the same error.
  select c.* into v_code
  from public.platform_invite_codes c
  where char_length(p_code) <= 200
    and c.code_hash = encode(extensions.digest(btrim(p_code), 'sha256'), 'hex')
    and c.revoked_at is null
    and c.expires_at > now()
    and c.used_count < c.max_uses
    and (c.email_hash is null or c.email_hash = v_email_hash)
  for update;

  if v_code.id is null then
    raise exception 'code:forbidden' using detail = 'invite code is not valid';
  end if;

  if p_name is null or p_slug is null then
    raise exception 'code:validation_failed' using detail = 'school name and slug are required';
  end if;

  begin
    v_institution_id := public.create_institution(p_name, p_slug);
  exception
    when check_violation then
      raise exception 'code:validation_failed' using detail = 'slug is reserved';
  end;

  -- create_institution leaves the membership-bootstrap bypass on until
  -- commit; nothing after this point may run under it.
  perform set_config('app.allow_membership_bootstrap', '', true);

  update public.platform_invite_codes as c
  set used_count = c.used_count + 1
  where c.id = v_code.id;

  insert into public.platform_invite_redemptions (invite_code_id, created_institution_id, user_id)
  values (v_code.id, v_institution_id, v_uid);

  return query
    select i.id, i.slug from public.institutions i where i.id = v_institution_id;
end;
$$;

revoke execute on function public.create_institution_with_invite(text, text, text) from public, anon;
grant execute on function public.create_institution_with_invite(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Template validation helpers (invoker, only called by apply_school_template)
-- ---------------------------------------------------------------------------

create function app.school_template_text(p_value jsonb, p_label text, p_max int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then
    raise exception 'code:validation_failed' using detail = p_label || ' must be text';
  end if;
  v_text := btrim(p_value #>> '{}');
  if char_length(v_text) not between 1 and p_max then
    raise exception 'code:validation_failed' using detail = format('%s must be 1-%s characters', p_label, p_max);
  end if;
  return v_text;
end;
$$;

create function app.school_template_list(p_value jsonb, p_label text, p_min int, p_max int)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_min = 0 and (p_value is null or jsonb_typeof(p_value) = 'null') then
    return '[]'::jsonb;
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    raise exception 'code:validation_failed' using detail = p_label || ' must be a list';
  end if;
  if jsonb_array_length(p_value) not between p_min and p_max then
    raise exception 'code:validation_failed' using detail = format('%s must have %s-%s items', p_label, p_min, p_max);
  end if;
  return p_value;
end;
$$;

create function app.school_template_date(p_value jsonb, p_label text)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := app.school_template_text(p_value, p_label, 10);
  v_date date;
begin
  if v_text ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_date := v_text::date;
    exception
      when datetime_field_overflow or invalid_datetime_format then
        v_date := null;
    end;
  end if;
  if v_date is null or v_date not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'code:validation_failed' using detail = p_label || ' must be a YYYY-MM-DD date';
  end if;
  return v_date;
end;
$$;

create function app.school_template_time(p_value jsonb, p_label text)
returns time
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := app.school_template_text(p_value, p_label, 5);
begin
  if v_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'code:validation_failed' using detail = p_label || ' must be a HH:MM time';
  end if;
  return v_text::time;
end;
$$;

revoke all on function app.school_template_text(jsonb, text, int) from public, anon, authenticated;
revoke all on function app.school_template_list(jsonb, text, int, int) from public, anon, authenticated;
revoke all on function app.school_template_date(jsonb, text) from public, anon, authenticated;
revoke all on function app.school_template_time(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- apply_school_template
-- ---------------------------------------------------------------------------

create function public.apply_school_template(p_institution_id uuid, p_template jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_year_id uuid;
  v_year_name text;
  v_year_start date;
  v_year_end date;
  v_item jsonb;
  v_inner jsonb;
  v_i int;
  v_label text;
  v_start date;
  v_end date;
  v_prev_end date;
  v_code text;
  v_kind text;
  v_group text;
  v_grade_id uuid;
  v_grade_ids uuid[] := array[]::uuid[];
  v_periods jsonb;
  v_time_start time;
  v_time_end time;
  v_prev_time_end time;
  v_is_break boolean;
  v_fee jsonb;
  v_fee_name text;
  v_heads text[] := array[]::text[];
  v_frequencies text[] := array[]::text[];
  v_amounts numeric[] := array[]::numeric[];
  v_paise numeric;
  v_structure_id uuid;
  v_rows int;
  v_n_terms int := 0;
  v_n_grades int := 0;
  v_n_sections int := 0;
  v_n_subjects int := 0;
  v_n_periods int := 0;
  v_n_structures int := 0;
  v_n_components int := 0;
  v_counts jsonb;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;
  if p_institution_id is null or not app.has_role(p_institution_id, array['owner']) then
    raise exception 'code:forbidden' using detail = 'only the school owner applies a setup template';
  end if;
  if p_template is null or jsonb_typeof(p_template) <> 'object' or octet_length(p_template::text) > 100000 then
    raise exception 'code:validation_failed' using detail = 'template must be a JSON object of at most 100000 bytes';
  end if;

  -- Serialise concurrent applies for this school; the grade check is the idempotency guard.
  perform pg_advisory_xact_lock(hashtext('apply_school_template:' || p_institution_id::text));
  if exists (select 1 from public.grades g where g.institution_id = p_institution_id) then
    raise exception 'code:conflict' using detail = 'this school already has grades; a template applies only to an empty school';
  end if;

  -- Academic year: reuse the current year create_institution made (replace its terms).
  v_year_name := app.school_template_text(p_template #> '{academic_year,name}', 'academic_year.name', 20);
  v_year_start := app.school_template_date(p_template #> '{academic_year,starts_on}', 'academic_year.starts_on');
  v_year_end := app.school_template_date(p_template #> '{academic_year,ends_on}', 'academic_year.ends_on');
  if v_year_end <= v_year_start or v_year_end - v_year_start > 400 then
    raise exception 'code:validation_failed' using detail = 'academic_year must end after it starts and span at most 400 days';
  end if;

  select y.id into v_year_id
  from public.academic_years y
  where y.institution_id = p_institution_id and y.is_current;

  begin
    if v_year_id is null then
      insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
      values (p_institution_id, v_year_name, v_year_start, v_year_end, true)
      returning id into v_year_id;
    else
      delete from public.terms t where t.academic_year_id = v_year_id;
      update public.academic_years y
      set name = v_year_name, starts_on = v_year_start, ends_on = v_year_end
      where y.id = v_year_id;
    end if;
  exception
    when foreign_key_violation or unique_violation then
      raise exception 'code:conflict' using detail = 'the current academic year is already in use; edit it in settings instead';
  end;

  v_i := 0;
  for v_item in select value from jsonb_array_elements(app.school_template_list(p_template -> 'terms', 'terms', 1, 4)) loop
    v_label := format('terms[%s]', v_i);
    v_start := app.school_template_date(v_item -> 'starts_on', v_label || '.starts_on');
    v_end := app.school_template_date(v_item -> 'ends_on', v_label || '.ends_on');
    if v_end <= v_start or v_start < v_year_start or v_end > v_year_end
      or (v_prev_end is not null and v_start <= v_prev_end)
    then
      raise exception 'code:validation_failed' using detail = v_label || ' must fall inside the academic year and start after the previous term ends';
    end if;
    v_i := v_i + 1;
    insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
    values (p_institution_id, v_year_id, app.school_template_text(v_item -> 'name', v_label || '.name', 60), v_i, v_start, v_end);
    v_prev_end := v_end;
  end loop;
  v_n_terms := v_i;

  -- Grades, their sections, and school-wide subjects (no grade-subject link table exists).
  begin
    v_i := 0;
    for v_item in select value from jsonb_array_elements(app.school_template_list(p_template -> 'grades', 'grades', 1, 15)) loop
      v_label := format('grades[%s]', v_i);
      v_code := app.school_template_text(v_item -> 'code', v_label || '.code', 10);
      if v_code !~ '^[A-Za-z0-9_-]+$' then
        raise exception 'code:validation_failed' using detail = v_label || '.code may use only letters, digits, _ and -';
      end if;
      v_group := app.school_template_text(v_item -> 'grade_group', v_label || '.grade_group', 20);
      if v_group not in ('primary', 'middle', 'secondary', 'senior_secondary') then
        raise exception 'code:validation_failed' using detail = v_label || '.grade_group must be primary, middle, secondary or senior_secondary';
      end if;
      v_i := v_i + 1;
      insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
      values (p_institution_id, v_code, app.school_template_text(v_item -> 'display_name', v_label || '.display_name', 60), v_i, v_group)
      returning id into v_grade_id;
      v_grade_ids := v_grade_ids || v_grade_id;

      for v_inner in select value from jsonb_array_elements(app.school_template_list(v_item -> 'sections', v_label || '.sections', 1, 8)) loop
        insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
        values (p_institution_id, v_grade_id, v_year_id, app.school_template_text(v_inner, v_label || '.sections[]', 20));
        v_n_sections := v_n_sections + 1;
      end loop;

      for v_inner in select value from jsonb_array_elements(app.school_template_list(v_item -> 'subjects', v_label || '.subjects', 0, 15)) loop
        v_code := app.school_template_text(v_inner -> 'code', v_label || '.subjects[].code', 20);
        if v_code !~ '^[A-Za-z0-9_-]+$' then
          raise exception 'code:validation_failed' using detail = v_label || '.subjects[].code may use only letters, digits, _ and -';
        end if;
        v_kind := app.school_template_text(v_inner -> 'kind', v_label || '.subjects[].kind', 20);
        if v_kind not in ('scholastic', 'co_scholastic', 'skill', 'language') then
          raise exception 'code:validation_failed' using detail = v_label || '.subjects[].kind must be scholastic, co_scholastic, skill or language';
        end if;
        insert into public.subjects (institution_id, code, name, kind)
        values (p_institution_id, v_code, app.school_template_text(v_inner -> 'name', v_label || '.subjects[].name', 60), v_kind)
        on conflict (institution_id, code) do nothing;
        get diagnostics v_rows = row_count;
        v_n_subjects := v_n_subjects + v_rows;
      end loop;
    end loop;
    v_n_grades := v_i;
  exception
    when unique_violation then
      raise exception 'code:validation_failed' using detail = 'grade codes, and section names within a grade, must be unique';
  end;

  -- Periods only when the school has no bell schedule yet.
  v_periods := app.school_template_list(p_template -> 'periods', 'periods', 0, 12);
  if jsonb_array_length(v_periods) > 0
    and not exists (select 1 from public.periods p where p.institution_id = p_institution_id)
  then
    v_i := 0;
    for v_item in select value from jsonb_array_elements(v_periods) loop
      v_label := format('periods[%s]', v_i);
      v_time_start := app.school_template_time(v_item -> 'starts_at', v_label || '.starts_at');
      v_time_end := app.school_template_time(v_item -> 'ends_at', v_label || '.ends_at');
      if v_time_end <= v_time_start or (v_prev_time_end is not null and v_time_start < v_prev_time_end) then
        raise exception 'code:validation_failed' using detail = v_label || ' must end after it starts and not overlap the previous period';
      end if;
      if v_item -> 'is_break' is null then
        v_is_break := false;
      elsif jsonb_typeof(v_item -> 'is_break') = 'boolean' then
        v_is_break := (v_item ->> 'is_break')::boolean;
      else
        raise exception 'code:validation_failed' using detail = v_label || '.is_break must be true or false';
      end if;
      v_i := v_i + 1;
      insert into public.periods (institution_id, seq, name, starts_at, ends_at, is_break)
      values (p_institution_id, v_i, app.school_template_text(v_item -> 'name', v_label || '.name', 30), v_time_start, v_time_end, v_is_break);
      v_prev_time_end := v_time_end;
    end loop;
    v_n_periods := v_i;
  end if;

  -- One draft fee structure: same name + components on every template grade, never default.
  v_fee := p_template -> 'fee_structure';
  if v_fee is not null and jsonb_typeof(v_fee) <> 'null' then
    v_fee_name := app.school_template_text(v_fee -> 'name', 'fee_structure.name', 120);
    v_i := 0;
    for v_item in select value from jsonb_array_elements(app.school_template_list(v_fee -> 'components', 'fee_structure.components', 1, 8)) loop
      v_label := format('fee_structure.components[%s]', v_i);
      v_i := v_i + 1;
      v_code := app.school_template_text(v_item -> 'head', v_label || '.head', 20);
      if v_code not in ('tuition', 'transport', 'annual_charges', 'admission', 'exam', 'lab_computer', 'activity', 'caution_deposit')
        or v_code = any(v_heads)
      then
        raise exception 'code:validation_failed' using detail = v_label || '.head must be a known fee head, used once';
      end if;
      v_kind := app.school_template_text(v_item -> 'frequency', v_label || '.frequency', 20);
      if v_kind not in ('one_time', 'annual', 'term', 'quarterly', 'monthly') then
        raise exception 'code:validation_failed' using detail = v_label || '.frequency must be one_time, annual, term, quarterly or monthly';
      end if;
      if v_item -> 'amount_paise' is null or jsonb_typeof(v_item -> 'amount_paise') <> 'number' then
        raise exception 'code:validation_failed' using detail = v_label || '.amount_paise must be a number';
      end if;
      v_paise := (v_item ->> 'amount_paise')::numeric;
      if v_paise <> trunc(v_paise) or v_paise not between 0 and 1000000000 then
        raise exception 'code:validation_failed' using detail = v_label || '.amount_paise must be a whole number of paise from 0 to 1000000000';
      end if;
      v_heads := v_heads || v_code;
      v_frequencies := v_frequencies || v_kind;
      v_amounts := v_amounts || (v_paise / 100);
    end loop;

    foreach v_grade_id in array v_grade_ids loop
      insert into public.fee_structures (institution_id, academic_year_id, grade_id, name, is_default)
      values (p_institution_id, v_year_id, v_grade_id, v_fee_name, false)
      returning id into v_structure_id;
      insert into public.fee_components (institution_id, fee_structure_id, head, amount, frequency)
      select p_institution_id, v_structure_id, u.head, u.amount, u.frequency
      from unnest(v_heads, v_amounts, v_frequencies) as u (head, amount, frequency);
    end loop;
    v_n_structures := cardinality(v_grade_ids);
    v_n_components := cardinality(v_grade_ids) * cardinality(v_heads);
  end if;

  v_counts := jsonb_build_object(
    'academic_years', 1,
    'terms', v_n_terms,
    'grades', v_n_grades,
    'class_sections', v_n_sections,
    'subjects', v_n_subjects,
    'periods', v_n_periods,
    'fee_structures', v_n_structures,
    'fee_components', v_n_components
  );

  perform app.audit(
    p_institution_id, v_uid, 'core.setup.template_applied', 'institutions', p_institution_id, null, null, v_counts
  );

  return v_counts;
end;
$$;

revoke execute on function public.apply_school_template(uuid, jsonb) from public, anon;
grant execute on function public.apply_school_template(uuid, jsonb) to authenticated;

-- Owner decision 2026-11-10: a school is created only with an invite code.
-- 0064 granted create_institution to every signed-in user (demo logins included);
-- from here the only client path is create_institution_with_invite, which calls it as definer.
revoke execute on function public.create_institution(text, text, text, date) from authenticated;

-- ---------------------------------------------------------------------------
-- School logo bucket (public read; managers of the school in the first folder write)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-branding', 'school-branding', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy school_branding_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'school-branding'
    and (storage.foldername(name))[1] = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])::text))
  );

create policy school_branding_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'school-branding'
    and name ~ '^[0-9a-f-]{36}/logo\.(png|jpg|jpeg|webp)$'
    and (storage.foldername(name))[1] = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])::text))
  );

create policy school_branding_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'school-branding'
    and (storage.foldername(name))[1] = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])::text))
  )
  with check (
    bucket_id = 'school-branding'
    and name ~ '^[0-9a-f-]{36}/logo\.(png|jpg|jpeg|webp)$'
    and (storage.foldername(name))[1] = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])::text))
  );

create policy school_branding_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'school-branding'
    and (storage.foldername(name))[1] = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])::text))
  );

-- Reserved slugs: SQL is the authority. 0101's list plus every top-level app
-- route that would shadow a tenant (platform, start, tour). A strict superset:
-- no 0101 value is removed. NOT VALID like 0101, so no existing row is checked
-- here; new and updated rows are. RESERVED_SLUGS in src/modules/core/schemas.ts
-- equals this list (tests/unit/reserved-slugs.test.ts).
alter table public.institutions drop constraint institutions_slug_not_reserved;
alter table public.institutions
  add constraint institutions_slug_not_reserved
  check (slug <> all (array[
    'api', 's', 'login', 'logout', 'auth', 'admin', 'app', 'www', 'static', 'public', 'demo', 'invite', 'onboarding',
    'portal', 'sw', 'select', 'product', 'modules', 'ai', 'security', 'pricing', 'how-it-works', 'faq', 'contact',
    'roles', 'legal', 'offline', 'icon', 'apple-icon', 'opengraph-image', 'sitemap', 'robots', 'manifest', 'llms', 'for-agents',
    'platform', 'start', 'tour'
  ])) not valid;
