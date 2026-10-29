-- T-020 (lead ruling, Batch B): every recheck rule enforced in SQL, because
-- guardians/students can call PostgREST directly and 0009's
-- `recheck_requests_insert` policy only checked ownership — not the window,
-- the reason length, or the one-open-request rule (that last one was always
-- a DB-level invariant via 0009's partial unique index, but relied on the
-- action layer to turn its 23505 into `conflict` rather than an opaque
-- `internal`). `app.request_recheck` / `app.start_recheck_review` follow
-- 0016's `app.decide_application` shape: role/ownership-checked INSIDE the
-- function, thin `public.*` wrapper, `app.*` revoked from
-- anon/authenticated/service_role, `public.*` granted to authenticated only,
-- `search_path=''`, qualified names, no dynamic SQL (07 §4).
--
-- `app.apply_recheck_decision` (0009, merged, never edited per CLAUDE.md
-- rule 9) is left exactly as it is — see the guard trigger note below for
-- why that is still safe.

-- ---------------------------------------------------------------------------
-- Drop the direct INSERT policy (0009) — the only write path into
-- `recheck_requests` for an ordinary member is now `app.request_recheck`,
-- which is `security definer` and bypasses RLS as its owner. No replacement
-- INSERT policy is created: `authenticated` has none, so a direct PostgREST
-- insert always fails with a plain RLS/permission error (42501), which is
-- exactly the "policy error (direct insert)" the packet's acceptance
-- criterion 2 asks for. `recheck_requests_select` (ownership-scoped) is
-- untouched — reading is still fine over PostgREST.
-- ---------------------------------------------------------------------------

drop policy recheck_requests_insert on public.recheck_requests;

-- ---------------------------------------------------------------------------
-- app.guard_recheck_request_status() — BEFORE UPDATE on recheck_requests.
-- Enforces 06 §W8's state machine directly (not a GUC-bypass-only guard, by
-- necessity): `app.apply_recheck_decision` is a MERGED function this packet
-- cannot edit, so it has no GUC to set before its own
-- under_review->rejected/applied updates — and there is deliberately no
-- UPDATE policy on this table for `authenticated` at all (see above), so no
-- ordinary caller can reach this trigger's UPDATE path in the first place.
-- The transition table below is therefore the full invariant, not a caller
-- check: only submitted->under_review (app.start_recheck_review) and
-- under_review->{approved,rejected,applied} (app.apply_recheck_decision) are
-- ever valid; anything else (including a future bug that tries to skip a
-- state, or move backwards) is rejected regardless of who is calling,
-- service_role/postgres excepted for the seed/demo-reset path.
-- ---------------------------------------------------------------------------

create function app.guard_recheck_request_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean;
begin
  v_trusted := (
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  );

  if new.status is distinct from old.status and not v_trusted then
    if not (
      (old.status = 'submitted' and new.status = 'under_review')
      or (old.status = 'under_review' and new.status in ('approved', 'rejected', 'applied'))
    ) then
      raise exception 'code:invalid_state' using detail = format('recheck_requests.status cannot move from %s to %s directly', old.status, new.status);
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_recheck_request_status() from public;

create trigger guard_recheck_request_status
before update on public.recheck_requests
for each row execute function app.guard_recheck_request_status();

-- ---------------------------------------------------------------------------
-- app.request_recheck(institution_id, result_id, exam_paper_id, reason) —
-- 06 §W8. Authorized caller is the result's own guardian/student (same
-- ownership shape as 0009's dropped INSERT policy) or an exam_write_roles
-- staff member filing on behalf (06 §W8 failure/retry note) — parity with
-- the policy this replaces, not a narrowing. Everything else (window,
-- reason length, duplicate-open-request) is new enforcement.
-- ---------------------------------------------------------------------------

create function app.request_recheck(p_institution_id uuid, p_result_id uuid, p_exam_paper_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_result public.results;
  v_paper public.exam_papers;
  v_authorized boolean;
  v_window_days int;
  v_timezone text;
  v_deadline date;
  v_today date;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_request_id uuid;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if length(v_reason) < 10 or length(v_reason) > 1000 then
    raise exception 'code:validation_failed' using detail = 'reason must be 10-1000 characters';
  end if;

  select * into v_result from public.results where id = p_result_id and institution_id = p_institution_id;
  if v_result.id is null then
    raise exception 'code:not_found' using detail = 'result not found for this institution';
  end if;
  if v_result.superseded_by is not null then
    raise exception 'code:not_found' using detail = 'this result has already been superseded by a later version';
  end if;

  select * into v_paper from public.exam_papers where id = p_exam_paper_id and institution_id = p_institution_id;
  if v_paper.id is null or v_paper.exam_id is distinct from v_result.exam_id then
    raise exception 'code:not_found' using detail = 'exam paper not found for this result';
  end if;

  -- coalesce(..., false): `app.own_student_id` returns null for any
  -- non-student caller (a guardian, for instance), and `x = null` is null,
  -- not false, in SQL's three-valued logic — `v_authorized` would be null
  -- rather than false for exactly the "guardian requesting another
  -- guardian's child's result" case, and plpgsql's `if not v_authorized`
  -- treats a null condition as "don't raise", silently letting the request
  -- through. Caught by tests/db/recheck-actions.test.ts's ownership case.
  v_authorized := coalesce(
    app.has_role(p_institution_id, app.exam_write_roles())
    or v_result.student_id in (select app.guardian_student_ids(p_institution_id))
    or v_result.student_id = app.own_student_id(p_institution_id),
    false
  );
  if not v_authorized then
    raise exception 'code:not_found' using detail = 'result not found for this institution';
  end if;

  select
    coalesce((i.settings -> 'exams' ->> 'recheck_window_days')::int, 7),
    coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata')
  into v_window_days, v_timezone
  from public.institutions i
  where i.id = p_institution_id;

  v_today := (now() at time zone v_timezone)::date;
  v_deadline := (v_result.published_at at time zone v_timezone)::date + v_window_days;
  if v_today > v_deadline then
    raise exception 'code:invalid_state' using detail = 'the recheck window for this result has closed';
  end if;

  begin
    insert into public.recheck_requests (institution_id, result_id, exam_paper_id, requested_by, reason)
    values (p_institution_id, p_result_id, p_exam_paper_id, v_caller, v_reason)
    returning id into v_request_id;
  exception
    when unique_violation then
      raise exception 'code:conflict' using detail = 'an open recheck request already exists for this result and paper';
  end;

  perform app.audit(
    p_institution_id, v_caller, 'exam.recheck.requested', 'recheck_request', v_request_id,
    null, jsonb_build_object('status', 'submitted'), jsonb_build_object('exam_paper_id', p_exam_paper_id, 'result_id', p_result_id)
  );

  return jsonb_build_object('request_id', v_request_id, 'status', 'submitted');
end;
$$;

revoke execute on function app.request_recheck(uuid, uuid, uuid, text) from public, anon, authenticated;

create function public.request_recheck(p_institution_id uuid, p_result_id uuid, p_exam_paper_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.request_recheck(p_institution_id, p_result_id, p_exam_paper_id, p_reason);
end;
$$;

revoke execute on function public.request_recheck(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.request_recheck(uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- app.start_recheck_review(institution_id, request_id) — exam_write_roles
-- only. submitted -> under_review; guarded by the trigger above like every
-- other transition.
-- ---------------------------------------------------------------------------

create function app.start_recheck_review(p_institution_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_request public.recheck_requests;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, app.exam_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.recheck.review for this institution';
  end if;

  select * into v_request from public.recheck_requests where id = p_request_id and institution_id = p_institution_id for update;
  if v_request.id is null then
    raise exception 'code:not_found' using detail = 'recheck request not found';
  end if;
  if v_request.status <> 'submitted' then
    raise exception 'code:invalid_state' using detail = format('request must be submitted to start review; current status is %s', v_request.status);
  end if;

  update public.recheck_requests set status = 'under_review' where id = p_request_id;

  perform app.audit(
    p_institution_id, v_caller, 'exam.recheck.review_started', 'recheck_request', p_request_id,
    jsonb_build_object('status', 'submitted'), jsonb_build_object('status', 'under_review'), null
  );

  return jsonb_build_object('request_id', p_request_id, 'status', 'under_review');
end;
$$;

revoke execute on function app.start_recheck_review(uuid, uuid) from public, anon, authenticated;

create function public.start_recheck_review(p_institution_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.start_recheck_review(p_institution_id, p_request_id);
end;
$$;

revoke execute on function public.start_recheck_review(uuid, uuid) from public, anon;
grant execute on function public.start_recheck_review(uuid, uuid) to authenticated;
