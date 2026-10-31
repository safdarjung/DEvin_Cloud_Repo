-- Bug fix (live bug hunt, 2026-10-31): `terms_select` (0003) only grants
-- SELECT to staff roles (`app.staff_roles()`), so `getCurrentTermId`
-- (src/modules/people/queries.ts) silently returns null for a guardian or
-- student — it queries `terms` directly to find "today's term" for the
-- portal's own attendance summary, and RLS hides every row. The guardian's
-- own child had a real active enrolment and a real current term; the
-- portal showed "No active enrolment or term to show attendance for."
-- Term start/end dates are academic-calendar metadata, not sensitive —
-- `grades` already grants any member read access the same way
-- (`app.is_member`, 0003). Adding a second permissive SELECT policy here
-- (rather than editing `terms_select`) leaves the original staff-only
-- policy's intent untouched; Postgres ORs multiple permissive policies for
-- the same command.
create policy terms_select_member on public.terms
  for select
  to authenticated
  using (app.is_member(institution_id));
