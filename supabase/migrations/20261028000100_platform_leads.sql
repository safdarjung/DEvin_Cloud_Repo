-- Platform-level marketing leads (book-a-demo / contact on the public site).
-- Not tenant data: no institution_id by design (these are prospects, not
-- members of any school). RLS is on with NO policies, so anon/authenticated
-- can neither read nor write; only service_role (the /api/public/lead route)
-- inserts, via the function below.

create table public.platform_leads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('demo', 'contact')),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) <= 200),
  phone text check (phone is null or char_length(phone) <= 30),
  institution_name text check (institution_name is null or char_length(institution_name) <= 200),
  role text check (role is null or char_length(role) <= 100),
  message text check (message is null or char_length(message) <= 2000),
  source_ip_hash text not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index platform_leads_ip_idx on public.platform_leads (source_ip_hash, created_at);
create index platform_leads_email_idx on public.platform_leads (lower(email), created_at);

create trigger set_updated_at
before update on public.platform_leads
for each row execute function app.set_updated_at();

alter table public.platform_leads enable row level security;
revoke all on public.platform_leads from anon, authenticated;

-- Defense in depth: validates again in SQL regardless of the route's Zod
-- parse; stores only a caller-supplied ip hash, never a raw IP.
create function app.submit_platform_lead(p_payload jsonb, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := coalesce(p_payload->>'kind', '');
  v_name text := trim(coalesce(p_payload->>'name', ''));
  v_email text := lower(trim(coalesce(p_payload->>'email', '')));
  v_phone text := nullif(trim(coalesce(p_payload->>'phone', '')), '');
  v_institution text := nullif(trim(coalesce(p_payload->>'institution', '')), '');
  v_role text := nullif(trim(coalesce(p_payload->>'role', '')), '');
  v_message text := nullif(trim(coalesce(p_payload->>'message', '')), '');
  v_recent int;
  v_existing uuid;
  v_id uuid;
begin
  if p_ip_hash is null or char_length(p_ip_hash) = 0 then
    raise exception 'code:validation_failed' using detail = 'ip hash required';
  end if;
  if v_kind not in ('demo', 'contact') then
    raise exception 'code:validation_failed' using detail = 'kind must be demo or contact';
  end if;
  if char_length(v_name) not between 1 and 200 then
    raise exception 'code:validation_failed' using detail = 'name must be 1-200 characters';
  end if;
  if char_length(v_email) > 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'code:validation_failed' using detail = 'email is not a valid address';
  end if;
  if v_phone is not null and char_length(v_phone) > 30 then
    raise exception 'code:validation_failed' using detail = 'phone too long';
  end if;
  if v_message is not null and char_length(v_message) > 2000 then
    raise exception 'code:validation_failed' using detail = 'message must be at most 2000 characters';
  end if;

  -- Serialise per ip hash so a parallel burst cannot slip past the count.
  perform pg_advisory_xact_lock(hashtext('platform_lead:' || p_ip_hash));

  -- Global ceiling against rotating-IP floods: 200 leads per hour overall.
  if (select count(*) from public.platform_leads l where l.created_at > now() - interval '60 minutes') >= 200 then
    raise exception 'code:rate_limited' using detail = 'too many submissions; try again later';
  end if;

  -- 5 submissions per ip hash per hour; the 6th is rejected.
  select count(*) into v_recent
  from public.platform_leads l
  where l.source_ip_hash = p_ip_hash and l.created_at > now() - interval '60 minutes';
  if v_recent >= 5 then
    raise exception 'code:rate_limited' using detail = 'too many submissions from this source; try again later';
  end if;

  -- Same email + kind within 24h returns the existing reference.
  select l.id into v_existing
  from public.platform_leads l
  where lower(l.email) = v_email and l.kind = v_kind and l.created_at > now() - interval '24 hours'
  order by l.created_at desc
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('lead_id', v_existing, 'reference', 'LEAD-' || left(v_existing::text, 8), 'duplicate', true);
  end if;

  insert into public.platform_leads (kind, name, email, phone, institution_name, role, message, source_ip_hash)
  values (v_kind, v_name, v_email, v_phone, v_institution, v_role, v_message, p_ip_hash)
  returning id into v_id;

  return jsonb_build_object('lead_id', v_id, 'reference', 'LEAD-' || left(v_id::text, 8), 'duplicate', false);
end;
$$;

revoke execute on function app.submit_platform_lead(jsonb, text) from public, anon, authenticated;

create function public.submit_platform_lead(p_payload jsonb, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.submit_platform_lead(p_payload, p_ip_hash);
end;
$$;

revoke execute on function public.submit_platform_lead(jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_platform_lead(jsonb, text) to service_role;
