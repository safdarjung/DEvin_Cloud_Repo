Packet: X06-T4 Zod schemas + row types

Files changed:
- src/modules/exam-seating/schemas.ts (new)
- tests/unit/exam-seating-schemas.test.ts (new)

Behavior implemented: Export 5 Zod schemas (GenerateSeatingSchema, SlotsQuerySchema, PlanIdSchema, StudentSeatsSchema, AdmitCardsSchema) with strict validation. Export 6 row type interfaces (SlotRow, ChartSeat, SeatingChart, StudentSeatRow, AdmitCardPaper, AdmitCard) with all fields per rulings §Queries & Display. All schemas validate offset-aware ISO datetime, UUID refs, no duplicate roomIds, max 50 rooms, unknown keys rejected.

Tests run: `pnpm test tests/unit/exam-seating-schemas.test.ts` → 12 passed (1 file) ✓

Tests not run and why: None—full unit coverage of all schemas.

Lint/typecheck: ✓ Lint OK. Typecheck shows 3 errors in certificates-schemas.test.ts (other packet, unrelated); exam-seating files are clean.

Limitations / honesty label: None—pure schema definitions, no database/runtime interaction.

Security / integration risks: None—schemas are read-only definitions. Row types are interface declarations only.

Follow-ups: None.

New dependencies: None.

Assumptions made: ISO datetime with offset required per M11 pattern (z.string().datetime({ offset: true })). Row types follow existing module patterns (interfaces, camelCase fields, string for ISO datetime and date strings, explicit null unions). Weekday field in AdmitCardPaper is a string (e.g. "Mon") to defer locale logic to T7/T8 renderers.

Commit: test: X06-T4 exam-seating schemas & row types (RED + GREEN)
