-- X03-T2: library_books, library_copies, library_loans, guard, issue/renew
-- RPCs, module_catalog insert (X03-tasks.md header rulings, part 1 of 2).
-- Part 2 (X03-T3) appends app.add_invoice_charge + return_library_loan.
--
-- "On loan" is never stored: it is an open loan (returned_on is null) on
-- library_loans, backstopped by the partial unique index
-- library_loans_open_copy_key. No INSERT/UPDATE/DELETE policy on loans —
-- the only writers are the RPCs below (lesson 3). Books/copies have no
-- DELETE policy either (withdraw a copy instead of deleting it).
--
-- app.guard_library_catalog (security invoker, lesson 5 bypass) keeps
-- institution_id and a copy's book_id immutable, and blocks withdrawing a
-- copy that has an open loan.
--
-- app.issue_library_loan / app.renew_library_loan: definer core (revoked
-- from everyone) + public.* thin wrapper (granted to authenticated only),
-- same split as 0070's decide_leave. Caller check on the row's
-- institution: owner/principal/admin proceed; an active member with
-- another role gets forbidden; a non-member gets not_found (never leaks
-- another institution's row existence).

create table public.library_books (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  title text not null check (char_length(title) between 1 and 200),
  author text not null check (char_length(author) between 1 and 120),
  isbn text check (isbn ~ '^([0-9]{9}[0-9X]|[0-9]{13})$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index library_books_isbn_key on public.library_books (institution_id, isbn) where isbn is not null;

create trigger set_updated_at
before update on public.library_books
for each row execute function app.set_updated_at();

alter table public.library_books enable row level security;

create policy library_books_select on public.library_books
  for select to authenticated
  using (institution_id = any((select app.member_institutions())));

create policy library_books_insert on public.library_books
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy library_books_update on public.library_books
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create table public.library_copies (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  book_id uuid not null references public.library_books (id),
  accession_no text not null check (char_length(accession_no) between 1 and 30 and accession_no ~ '^[A-Z0-9/-]+$'),
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index library_copies_accession_key on public.library_copies (institution_id, accession_no);
create index library_copies_book_id_idx on public.library_copies (book_id);

create trigger set_updated_at
before update on public.library_copies
for each row execute function app.set_updated_at();

alter table public.library_copies enable row level security;

create policy library_copies_select on public.library_copies
  for select to authenticated
  using (institution_id = any((select app.member_institutions())));

create policy library_copies_insert on public.library_copies
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.library_books b
      where b.id = library_copies.book_id and b.institution_id = library_copies.institution_id
    )
  );

create policy library_copies_update on public.library_copies
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.library_books b
      where b.id = library_copies.book_id and b.institution_id = library_copies.institution_id
    )
  );

-- ---------------------------------------------------------------------------
-- app.guard_library_catalog — security invoker (lesson 5 bypass): keeps
-- institution_id and a copy's book_id immutable; blocks withdrawing a copy
-- that currently has an open loan.
-- ---------------------------------------------------------------------------

create function app.guard_library_catalog()
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

  if new.institution_id <> old.institution_id then
    raise exception 'code:invalid_state' using detail = 'institution_id is immutable';
  end if;

  if tg_table_name = 'library_copies' then
    if new.book_id <> old.book_id then
      raise exception 'code:invalid_state' using detail = 'book_id is immutable';
    end if;

    if new.status = 'withdrawn' and old.status <> 'withdrawn'
      and exists (select 1 from public.library_loans where copy_id = new.id and returned_on is null)
    then
      raise exception 'code:conflict' using detail = 'copy is on loan';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_library_catalog() from public;

create trigger guard_library_catalog
before update on public.library_books
for each row execute function app.guard_library_catalog();

create trigger guard_library_catalog
before update on public.library_copies
for each row execute function app.guard_library_catalog();

create table public.library_loans (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  copy_id uuid not null references public.library_copies (id),
  student_id uuid references public.students (id),
  staff_id uuid references public.staff (id),
  issued_on date not null,
  due_on date not null check (due_on >= issued_on),
  renew_count smallint not null default 0 check (renew_count between 0 and 2),
  returned_on date check (returned_on >= issued_on),
  fine_amount numeric(12, 2) not null default 0 check (fine_amount >= 0),
  fine_waived boolean not null default false,
  fine_invoice_line_id uuid references public.invoice_lines (id),
  issued_by uuid references public.profiles (id),
  returned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_loans_one_borrower check (num_nonnulls(student_id, staff_id) = 1)
);

create unique index library_loans_open_copy_key on public.library_loans (copy_id) where returned_on is null;
create index library_loans_institution_due_idx on public.library_loans (institution_id, due_on) where returned_on is null;
create index library_loans_student_id_idx on public.library_loans (student_id) where student_id is not null;
create index library_loans_staff_id_idx on public.library_loans (staff_id) where staff_id is not null;

create trigger set_updated_at
before update on public.library_loans
for each row execute function app.set_updated_at();

alter table public.library_loans enable row level security;

-- No INSERT/UPDATE/DELETE policy (lesson 3): issue/renew/return RPCs only.
create policy library_loans_select on public.library_loans
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or student_id = any((select app.my_student_ids()))
    or staff_id = any((select app.my_staff_ids()))
  );

-- ---------------------------------------------------------------------------
-- public.issue_library_loan — app.* core (revoked from everyone) + public.*
-- thin wrapper. "Today" = now() in the institution's locale timezone
-- (default Asia/Kolkata).
-- ---------------------------------------------------------------------------

create function app.issue_library_loan(p_copy_id uuid, p_student_id uuid default null, p_staff_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_copy public.library_copies;
  v_institution uuid;
  v_settings jsonb;
  v_timezone text;
  v_today date;
  v_loan_days int;
  v_limit int;
  v_borrower_status text;
  v_borrower_kind text;
  v_open_count int;
  v_loan_id uuid;
  v_due_on date;
begin
  select * into v_copy from public.library_copies where id = p_copy_id for update;
  if v_copy.id is null then
    raise exception 'code:not_found' using detail = 'copy not found';
  end if;
  v_institution := v_copy.institution_id;

  if not app.has_role(v_institution, array['owner', 'principal', 'admin']) then
    if v_institution = any((select app.member_institutions())) then
      raise exception 'code:forbidden' using detail = 'caller does not hold library.manage for this institution';
    else
      raise exception 'code:not_found' using detail = 'copy not found';
    end if;
  end if;

  if num_nonnulls(p_student_id, p_staff_id) <> 1 then
    raise exception 'code:validation_failed' using detail = 'exactly one of studentId or staffId is required';
  end if;

  select settings into v_settings from public.institutions where id = v_institution;
  v_timezone := coalesce(v_settings -> 'locale' ->> 'timezone', 'Asia/Kolkata');
  v_today := (now() at time zone v_timezone)::date;
  v_loan_days := coalesce((v_settings -> 'library' ->> 'loan_days')::int, 14);

  if p_student_id is not null then
    v_borrower_kind := 'student';
    select status into v_borrower_status from public.students where id = p_student_id and institution_id = v_institution;
    if v_borrower_status is null then
      raise exception 'code:not_found' using detail = 'student not found';
    end if;
    if v_borrower_status <> 'active' then
      raise exception 'code:invalid_state' using detail = 'student is not active';
    end if;
    v_limit := coalesce((v_settings -> 'library' ->> 'max_loans_student')::int, 2);
  else
    v_borrower_kind := 'staff';
    select status into v_borrower_status from public.staff where id = p_staff_id and institution_id = v_institution;
    if v_borrower_status is null then
      raise exception 'code:not_found' using detail = 'staff not found';
    end if;
    if v_borrower_status <> 'active' then
      raise exception 'code:invalid_state' using detail = 'staff member is not active';
    end if;
    v_limit := coalesce((v_settings -> 'library' ->> 'max_loans_staff')::int, 5);
  end if;

  if v_copy.status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'copy is withdrawn';
  end if;

  if exists (select 1 from public.library_loans where copy_id = p_copy_id and returned_on is null) then
    raise exception 'code:conflict' using detail = 'copy is already on loan';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('library_borrower:' || coalesce(p_student_id, p_staff_id)::text, 0));

  if exists (
    select 1 from public.library_loans l
    where l.returned_on is null
      and l.due_on < v_today
      and ((p_student_id is not null and l.student_id = p_student_id) or (p_staff_id is not null and l.staff_id = p_staff_id))
  ) then
    raise exception 'code:invalid_state' using detail = 'borrower has an overdue book';
  end if;

  select count(*) into v_open_count
  from public.library_loans l
  where l.returned_on is null
    and ((p_student_id is not null and l.student_id = p_student_id) or (p_staff_id is not null and l.staff_id = p_staff_id));

  if v_open_count >= v_limit then
    raise exception 'code:conflict' using detail = 'borrowing limit reached';
  end if;

  v_due_on := v_today + v_loan_days;

  insert into public.library_loans (institution_id, copy_id, student_id, staff_id, issued_on, due_on, issued_by)
  values (v_institution, p_copy_id, p_student_id, p_staff_id, v_today, v_due_on, app.current_user_id())
  returning id into v_loan_id;

  perform app.audit(
    v_institution,
    app.current_user_id(),
    'library.loan.issued',
    'library_loans',
    v_loan_id,
    null,
    jsonb_build_object('loan_id', v_loan_id, 'copy_id', p_copy_id, 'borrower_kind', v_borrower_kind, 'due_on', v_due_on),
    null
  );

  return jsonb_build_object('loan_id', v_loan_id, 'due_on', v_due_on);
end;
$$;

revoke execute on function app.issue_library_loan(uuid, uuid, uuid) from public, anon, authenticated;

create function public.issue_library_loan(p_copy_id uuid, p_student_id uuid default null, p_staff_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.issue_library_loan(p_copy_id, p_student_id, p_staff_id);
end;
$$;

revoke execute on function public.issue_library_loan(uuid, uuid, uuid) from public, anon;
grant execute on function public.issue_library_loan(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.renew_library_loan — app.* core (revoked from everyone) + public.*
-- thin wrapper.
-- ---------------------------------------------------------------------------

create function app.renew_library_loan(p_loan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.library_loans;
  v_institution uuid;
  v_settings jsonb;
  v_timezone text;
  v_today date;
  v_loan_days int;
  v_due_on date;
  v_renew_count smallint;
begin
  select * into v_loan from public.library_loans where id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'code:not_found' using detail = 'loan not found';
  end if;
  v_institution := v_loan.institution_id;

  if not app.has_role(v_institution, array['owner', 'principal', 'admin']) then
    if v_institution = any((select app.member_institutions())) then
      raise exception 'code:forbidden' using detail = 'caller does not hold library.manage for this institution';
    else
      raise exception 'code:not_found' using detail = 'loan not found';
    end if;
  end if;

  select settings into v_settings from public.institutions where id = v_institution;
  v_timezone := coalesce(v_settings -> 'locale' ->> 'timezone', 'Asia/Kolkata');
  v_today := (now() at time zone v_timezone)::date;
  v_loan_days := coalesce((v_settings -> 'library' ->> 'loan_days')::int, 14);

  if v_loan.returned_on is not null then
    raise exception 'code:invalid_state' using detail = 'loan already returned';
  end if;

  if v_loan.due_on < v_today then
    raise exception 'code:invalid_state' using detail = 'overdue — return it first';
  end if;

  if v_loan.renew_count >= 2 then
    raise exception 'code:invalid_state' using detail = 'renewal limit reached';
  end if;

  v_due_on := v_today + v_loan_days;
  v_renew_count := v_loan.renew_count + 1;

  update public.library_loans
  set due_on = v_due_on, renew_count = v_renew_count
  where id = p_loan_id;

  perform app.audit(
    v_institution,
    app.current_user_id(),
    'library.loan.renewed',
    'library_loans',
    p_loan_id,
    null,
    jsonb_build_object('loan_id', p_loan_id, 'due_on', v_due_on, 'renew_count', v_renew_count),
    null
  );

  return jsonb_build_object('loan_id', p_loan_id, 'due_on', v_due_on);
end;
$$;

revoke execute on function app.renew_library_loan(uuid) from public, anon, authenticated;

create function public.renew_library_loan(p_loan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.renew_library_loan(p_loan_id);
end;
$$;

revoke execute on function public.renew_library_loan(uuid) from public, anon;
grant execute on function public.renew_library_loan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- app.module_catalog — library, default off (MOD, D45). app.module_enabled
-- itself is not redefined here (0084, MOD-T12 owns it).
-- ---------------------------------------------------------------------------

insert into app.module_catalog (key, default_enabled) values ('library', false)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- Part 2 (X03-T3): app.add_invoice_charge (finance-owned, no public.*
-- wrapper — callers are definers owned by postgres, lesson 4) and
-- app.return_library_loan / public.return_library_loan.
-- ---------------------------------------------------------------------------

-- app.add_invoice_charge(...) — same row lock as app.record_payment (0008)
-- on the invoice; adds an ad-hoc charge line and books it Dr
-- fees_receivable / Cr fee_income. `library` is the first caller (X04/0087
-- may reuse it per rulings); execute revoked from everyone including
-- service_role, since every caller is itself a security-definer function
-- owned by postgres.
create function app.add_invoice_charge(p_invoice_id uuid, p_head text, p_description text, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_timezone text;
  v_today date;
  v_new_status text;
  v_line_id uuid;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'code:not_found' using detail = 'invoice not found';
  end if;

  if v_invoice.status = 'cancelled' then
    raise exception 'code:invalid_state' using detail = 'invoice is cancelled';
  end if;

  if p_head !~ '^[a-z_]{1,40}$' then
    raise exception 'code:validation_failed' using detail = 'head must be lowercase snake_case, 1-40 characters';
  end if;

  if char_length(p_description) < 1 or char_length(p_description) > 200 then
    raise exception 'code:validation_failed' using detail = 'description must be 1-200 characters';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 100000 or round(p_amount, 2) <> p_amount then
    raise exception 'code:validation_failed' using detail = 'amount must be greater than 0, at most 100000, with at most 2 decimals';
  end if;

  insert into public.invoice_lines (institution_id, invoice_id, head, description, amount, concession_amount)
  values (v_invoice.institution_id, p_invoice_id, p_head, p_description, p_amount, 0)
  returning id into v_line_id;

  v_new_status := case when v_invoice.status = 'paid' then 'part_paid' else v_invoice.status end;

  update public.invoices
  set subtotal = subtotal + p_amount, total = total + p_amount, status = v_new_status
  where id = p_invoice_id;

  select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_timezone
  from public.institutions i where i.id = v_invoice.institution_id;
  v_today := (now() at time zone v_timezone)::date;

  insert into public.ledger_entries (institution_id, invoice_id, account, debit, credit, entry_date, memo)
  values (v_invoice.institution_id, p_invoice_id, 'fees_receivable', p_amount, 0, v_today, p_head || ' invoice ' || v_invoice.invoice_no);

  insert into public.ledger_entries (institution_id, invoice_id, account, debit, credit, entry_date, memo)
  values (v_invoice.institution_id, p_invoice_id, 'fee_income', 0, p_amount, v_today, p_head || ' invoice ' || v_invoice.invoice_no);

  perform app.audit(
    v_invoice.institution_id,
    app.current_user_id(),
    'finance.invoice.charge_added',
    'invoice',
    p_invoice_id,
    null,
    jsonb_build_object('invoice_id', p_invoice_id, 'line_id', v_line_id, 'head', p_head, 'amount', p_amount),
    null
  );

  return v_line_id;
end;
$$;

revoke execute on function app.add_invoice_charge(uuid, text, text, numeric) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.return_library_loan — app.* core (revoked from everyone) + public.*
-- thin wrapper, same caller-check shape as issue/renew above. Staff
-- borrowers are fine-exempt (p_waive_fine ignored for them). A student
-- fine with no non-cancelled invoice to charge raises before anything is
-- written, so the loan stays open (librarian waives, or an invoice is
-- generated first, then return is retried).
-- ---------------------------------------------------------------------------

create function app.return_library_loan(p_loan_id uuid, p_waive_fine boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.library_loans;
  v_institution uuid;
  v_settings jsonb;
  v_timezone text;
  v_today date;
  v_fine_per_day numeric;
  v_days_late int;
  v_fine_amount numeric(12, 2);
  v_fine_waived boolean;
  v_invoice_id uuid;
  v_line_id uuid;
  v_title text;
begin
  select * into v_loan from public.library_loans where id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'code:not_found' using detail = 'loan not found';
  end if;
  v_institution := v_loan.institution_id;

  if not app.has_role(v_institution, array['owner', 'principal', 'admin']) then
    if v_institution = any((select app.member_institutions())) then
      raise exception 'code:forbidden' using detail = 'caller does not hold library.manage for this institution';
    else
      raise exception 'code:not_found' using detail = 'loan not found';
    end if;
  end if;

  if v_loan.returned_on is not null then
    raise exception 'code:invalid_state' using detail = 'loan already returned';
  end if;

  select settings into v_settings from public.institutions where id = v_institution;
  v_timezone := coalesce(v_settings -> 'locale' ->> 'timezone', 'Asia/Kolkata');
  v_today := (now() at time zone v_timezone)::date;
  v_fine_per_day := coalesce((v_settings -> 'library' ->> 'fine_per_day')::numeric, 1);

  v_days_late := greatest(0, v_today - v_loan.due_on);

  if v_loan.student_id is not null then
    v_fine_amount := round(v_days_late * v_fine_per_day, 2);
    v_fine_waived := p_waive_fine;
  else
    -- staff are fine-exempt; p_waive_fine is ignored for them.
    v_fine_amount := 0;
    v_fine_waived := false;
  end if;

  v_invoice_id := null;
  v_line_id := null;

  if v_fine_amount > 0 and not v_fine_waived then
    select i.id into v_invoice_id
    from public.invoices i
    join public.terms t on t.id = i.term_id
    where i.student_id = v_loan.student_id
      and i.institution_id = v_institution
      and i.status <> 'cancelled'
      and t.starts_on <= v_today
    order by t.starts_on desc
    limit 1;

    if v_invoice_id is null then
      raise exception 'code:invalid_state' using detail = 'no fee invoice to add the fine to';
    end if;

    select b.title into v_title
    from public.library_copies c
    join public.library_books b on b.id = c.book_id
    where c.id = v_loan.copy_id;

    v_line_id := app.add_invoice_charge(
      v_invoice_id,
      'library_fine',
      'Library fine: ' || left(coalesce(v_title, ''), 120) || ' (' || v_days_late || ' days late)',
      v_fine_amount
    );
  end if;

  update public.library_loans
  set returned_on = v_today,
      returned_by = app.current_user_id(),
      fine_amount = v_fine_amount,
      fine_waived = v_fine_waived,
      fine_invoice_line_id = v_line_id
  where id = p_loan_id;

  perform app.audit(
    v_institution,
    app.current_user_id(),
    'library.loan.returned',
    'library_loans',
    p_loan_id,
    null,
    jsonb_build_object('loan_id', p_loan_id, 'days_late', v_days_late, 'fine_amount', v_fine_amount, 'fine_waived', v_fine_waived, 'invoice_id', v_invoice_id),
    null
  );

  return jsonb_build_object(
    'loan_id', p_loan_id,
    'returned_on', v_today,
    'days_late', v_days_late,
    'fine_amount', v_fine_amount,
    'fine_waived', v_fine_waived,
    'invoice_line_id', v_line_id
  );
end;
$$;

revoke execute on function app.return_library_loan(uuid, boolean) from public, anon, authenticated;

create function public.return_library_loan(p_loan_id uuid, p_waive_fine boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.return_library_loan(p_loan_id, p_waive_fine);
end;
$$;

revoke execute on function public.return_library_loan(uuid, boolean) from public, anon;
grant execute on function public.return_library_loan(uuid, boolean) to authenticated;
