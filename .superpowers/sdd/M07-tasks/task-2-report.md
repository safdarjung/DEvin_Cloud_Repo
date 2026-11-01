Packet: T-002 M07-T2 Migration 0069 — rooms, periods, timetable versions/slots, publish_timetable

Files changed:
- supabase/migrations/20261028000069_timetable.sql (new)
- tests/db/timetable-rls.test.ts (new)
- src/lib/db/types.ts (regen, `pnpm db:types`, additions only)
- tests/security/grants.test.ts (added `public.publish_timetable` to PUBLIC_AUTHENTICATED)
- tests/security/rls-expectations.ts (added rooms/periods/timetable_versions/timetable_slots entries)

Behavior implemented:
- `rooms` (name 1-40 unique/institution, capacity 1-500) and `periods` (seq 1-12 unique/institution, name 1-30, starts_at<ends_at, is_break) — RLS: select any active member, write owner/principal/admin.
- `timetable_versions` (academic_year_id, name 1-60, status draft/published/archived, published_at/by, created_by) with a partial unique index `timetable_versions_one_published_idx (institution_id, academic_year_id) where status='published'` — DB-level guarantee of one published version per year.
- `timetable_slots` (version_id, class_section_id, teacher_id, room_id nullable, weekday 1-6, period_id) with three conflict constraints: `timetable_slots_section_slot_key` (version, section, weekday, period), `timetable_slots_teacher_slot_key` (version, teacher, weekday, period), `timetable_slots_room_unique_idx` (version, room, weekday, period, partial where room_id is not null). Double-booking is impossible by constraint — proved via 23505 in tests, not app logic.
- Every slot FK (class_section_id, teacher_id via `app.staff_in_institution`, room_id, period_id, version_id) is bound to the row's own institution_id in the insert/update policy (lesson 2).
- RLS SELECT on timetable_versions/timetable_slots: owner/principal/admin see everything; admissions/accountant/exam_controller/teacher see published only; guardian/student see published slots scoped to `app.my_student_section_ids()`. Uses `app.my_institution_ids`/`app.member_institutions`/`app.my_student_section_ids` initPlan helpers throughout (lesson 7), no new per-row definer calls added.
- `public.publish_timetable(p_version_id)` → `app.publish_timetable`: definer, checks caller holds owner/principal/admin for the version's institution, draft-only, archives the previous published version of the same (institution_id, academic_year_id) before flipping the target to published (order matters — avoids tripping the partial unique index), audits `timetable.published`.

SECURITY DEFINER functions added (role/institution check each):
- `app.guard_timetable_slots_period` — no role check (data validation only: rejects any slot whose `period_id` is a break period); definer only so the check doesn't depend on the caller's own select-visibility of `periods`.
- `app.guard_timetable_slots_write` — bypass only for `service_role`/`postgres` session; otherwise blocks insert/update/delete on `timetable_slots` unless the parent `timetable_versions.status = 'draft'`.
- `app.publish_timetable` — `app.has_role(v_version.institution_id, array['owner','principal','admin'])`; draft-only guard before publishing.
- `public.publish_timetable` — thin wrapper, re-delegates to `app.publish_timetable` (which re-checks role itself).
(`app.guard_timetable_versions_update` trigger function is plain plpgsql, not definer — same shape as 0068's `guard_announcements_update` — bypass on service_role/postgres or the `app.allow_timetable_publish` GUC; blocks any other direct status change.)

Tests run:
- `pnpm test:db tests/db/timetable-rls.test.ts` → 11 passed (conflict x3 — teacher/room/break-period, happy-path draft build, publish+archive, publish guards, edit/delete-after-publish rejection, guardian scoping, teacher/non-manager scoping, cross-institution FK rejection, rooms/periods baseline RLS).
- `pnpm test:security` → 1418 passed (full suite, run once at the end as instructed).
- `pnpm lint` → clean. `pnpm typecheck` → clean.

Tests not run and why: `pnpm test:e2e`/`pnpm test` (unit) not run — out of scope for a migration-only packet, no src changes outside types.ts.

Limitations / honesty label: n/a — no AI/simulated surface in this packet.

Security / integration risks:
- `rooms`/`periods` SELECT is "any active member" (matches ruling literally) — a guardian/student can read the room/period catalog (not sensitive: names, capacities, bell times), consistent with how `institutions` itself is readable by all 9 roles.
- `src/modules/timetable/schemas.ts` was being written by a parallel Haiku agent — not touched here, no action/query layer added in this packet (T4-T7 own that).

Follow-ups: none new; T3 (Haiku, permissions already landed per git log)/T4-T7 build actions/queries/UI on top of this migration.

New dependencies (justification): none.

Assumptions made:
- "other staff roles published only" (ruling) = admissions/accountant/exam_controller/teacher (i.e. `app.staff_roles()` minus owner/principal/admin); no existing DB helper named this set, so it's inlined as a literal array in the one SELECT policy that needs it rather than adding a new helper function (smallest complete change).
- Security-test fix round: initial guard trigger wrote `current_setting('app.allow_timetable_publish', true) = 'on'` as a third `or` clause inside the single `if ... then` that also checks service_role/postgres — `tests/security/grants.test.ts`'s NULL-safe-GUC-compare check flagged that continuation line (doesn't match its single-line `if...then` exemption regex). Fixed by splitting into two separate single-line `if ... then` blocks, matching 0068's `guard_announcements_update` shape exactly. Re-applied via a local node script reading `SUPABASE_DB_URL` from `.env.local` (no psql, no env values printed), then re-ran `pnpm test:security` (1418 passed) and `pnpm test:db tests/db/timetable-rls.test.ts` (11 passed) to confirm.
