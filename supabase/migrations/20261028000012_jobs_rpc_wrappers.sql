-- Fix (T-037): the web `/api/jobs/run` route must call the job runner as
-- the service role, never as a direct Postgres superuser connection — a
-- superuser DSN in the web app's env bypasses RLS *and* the
-- `createAdminClient()` SERVICE_ROLE_CALLER guard entirely (07 §4).
--
-- `app.claim_job`/`app.complete_job` (0003) cannot be called directly by
-- the web app: they live in the `app` schema, which `supabase/config.toml`
-- does not expose over PostgREST (only public/storage/graphql_public), so
-- `supabase-js`'s `.rpc()` can't route to them regardless of grants. These
-- thin `public` wrappers are `security definer` (owned by the migration
-- runner, same as every app.* function) so the nested `app.*` call runs
-- under the *owner's* privileges, not the caller's (0011's rationale) —
-- `service_role` needs no direct `app` schema grant.
--
-- Dead-lettering an unknown job type is NOT wrapped here: `public.jobs` is
-- in the exposed `public` schema and `service_role` already has BYPASSRLS
-- (0011) plus Supabase's standard table-level grants on `public`, so
-- `createRunnerPorts`'s `killUnknown` port updates `public.jobs` directly
-- via the admin client — no wrapper needed for that path.

create function public.jobs_claim(p_worker_id text)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.claim_job(p_worker_id);
end;
$$;

create function public.jobs_complete(p_id uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.complete_job(p_id, p_ok, p_error);
end;
$$;

revoke execute on function public.jobs_claim(text), public.jobs_complete(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.jobs_claim(text), public.jobs_complete(uuid, boolean, text)
  to service_role;

-- Fix (T-037 security review, HIGH): `jobs_update` (0003:307) let any
-- owner/principal/admin run an arbitrary `update public.jobs set
-- type=…, payload=…, max_attempts=…, …` over raw PostgREST — a real
-- handler later runs that row's `type`/`payload` with service-role
-- privileges, so a tenant admin could rewrite a queued job into one that
-- runs a different handler against arbitrary payload. The only legitimate
-- tenant-side mutation is "requeue a dead job", so the policy is replaced
-- with a narrow security-definer function that can do only that.
drop policy jobs_update on public.jobs;
-- Table-level revoke too (defense in depth): even if a future policy is
-- added back by mistake, `authenticated` has no UPDATE grant at all.
-- `service_role` is untouched — BYPASSRLS (0011) and Supabase's standard
-- grants already cover `createRunnerPorts`'s direct `killUnknown` update.
revoke update on public.jobs from authenticated;

create function public.jobs_requeue(p_institution_id uuid, p_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_before jsonb;
  v_after jsonb;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller is not an owner/principal/admin of the target institution';
  end if;

  select * into v_job from public.jobs where id = p_id and institution_id = p_institution_id;

  if v_job.id is null then
    raise exception 'code:not_found' using detail = 'job not found for this institution';
  end if;

  if v_job.status <> 'dead' then
    raise exception 'code:invalid_state' using detail = 'only a dead-lettered job can be requeued';
  end if;

  -- Audit `before`/`after` is status+attempts only — never `payload` or
  -- `last_error` (may hold PII or, per the HIGH fix above, attacker-chosen
  -- text); `audit_events.before`/`after` is itself confidential-class but
  -- this keeps the row minimal regardless.
  v_before := jsonb_build_object('status', v_job.status, 'attempts', v_job.attempts);

  update public.jobs
  set status = 'queued', attempts = 0, last_error = null, locked_at = null, locked_by = null, run_after = now()
  where id = p_id
  returning * into v_job;

  v_after := jsonb_build_object('status', v_job.status, 'attempts', v_job.attempts);

  perform app.audit(p_institution_id, app.current_user_id(), 'job.requeue', 'job', p_id, v_before, v_after, null);

  return v_job;
end;
$$;

revoke execute on function public.jobs_requeue(uuid, uuid) from public, anon;
grant execute on function public.jobs_requeue(uuid, uuid) to authenticated;
