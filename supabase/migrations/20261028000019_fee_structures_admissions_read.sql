-- T-028 (lead ruling, phase 2) — fee_structures_select RLS fix.
--
-- Found while implementing enrolApplicant/EnrolDialog: 07 §2.2 grants
-- admissions.enrol to owner/principal/admin/admissions, but
-- fee_structures_select (20261028000008) is app.finance_roles() = owner/
-- principal/admin/accountant — admissions is NOT in that list. An
-- admissions-role caller (the demo's admissions@demo.coolskool.test user,
-- the real J-05 persona) picking a fee structure to enrol a student sees
-- zero rows: RLS, not a bug in the TS layer.
--
-- Read-only fix: drop/recreate fee_structures_select to also allow
-- "admissions" SELECT (same drop/recreate shape 0014/0016 used). Writes
-- stay finance_roles()-only — admissions.enrol lets a caller pick an
-- existing structure, not create/edit one (finance.structure.manage is a
-- separate permission that excludes admissions in 07 §2.2 too).
--
-- fee_components stays untouched: EnrolDialog never reads fee_components
-- (only fee_structures.name/is_default via listFeeStructures) — granting
-- fee_components read to admissions would be more access than the feature
-- needs. listFeeStructures' embedded `fee_components(count)` select still
-- returns 0 for admissions (fee_components RLS still finance_roles()-only),
-- but EnrolDialog never renders that count, so this is harmless.
--
-- invoices/invoice_lines stay excluded for admissions (finance.read matrix
-- row is owner/principal/admin/accountant + student/guardian own-scope,
-- admissions excluded) — unrelated to this fix, left as-is.

drop policy fee_structures_select on public.fee_structures;

create policy fee_structures_select on public.fee_structures
  for select to authenticated
  using (app.has_role(fee_structures.institution_id, array['owner', 'principal', 'admin', 'accountant', 'admissions']));
