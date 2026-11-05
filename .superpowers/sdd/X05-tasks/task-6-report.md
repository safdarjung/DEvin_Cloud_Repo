Packet: X05-T6 Seed section `notifications`
Files changed: scripts/seed/sections/notifications.ts (new), scripts/seed/index.ts (register last), tests/db/seed-whatsapp.test.ts (new)
Behavior implemented: new seed section upserts guardian.two's {announcement, whatsapp, enabled:false} preference, then calls createNotification for one `announcement` (en, to guardian.one + guardian.two) and one `attendance_absence` (hi, to guardian.one, for Aarav/VI-A, date = attendance.ts's SCHOOL_DAYS[0]). Demo tenant is_demo=true so both land as simulated/simulated-whatsapp via existing channelFor logic — no seed-side demo branching needed. Idempotent via service.ts's existing type:entityId:recipientUserId key, so reseed adds no rows.
Tests run: `pnpm demo:reset` (DEMO_RESET_ALLOWED=true) → seed complete, notifications: 104ms; `pnpm test:db tests/db/seed-whatsapp.test.ts` → 4/4 pass (incl. reseed-no-duplicate case, which runs its own demo:reset); `pnpm test:db tests/db/seed-determinism.test.ts` → 1/1 pass; `pnpm lint` clean; `pnpm typecheck` clean.
Tests not run and why: tests/db/seed-timetable.test.ts / other seed-*.test.ts not touched by this change, skipped to save time.
Limitations / honesty label: whatsapp rows inherit `<SimulatedBadge />` via existing M17-T4 rule (status='simulated'); no new UI.
Security / integration risks: none — no new tables/policies/permissions; writes go through existing createNotification/service.ts and a direct notification_preferences upsert (same pattern other seed sections use with the service-role client).
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: "seed base date" = attendance.ts's exported SCHOOL_DAYS[0] ("2026-08-08", the attendance window's first school day) since no other named base-date constant exists in the seed scripts.
