Packet: X07-T3 Visitors Zod schemas
Files changed: src/modules/visitors/schemas.ts; tests/unit/visitors-schemas.test.ts
Behavior implemented: Created visitors module with 10 Zod schemas (check-in, check-out, purge, list, pickup add/remove/list, gate pass create/setStatus/list). All schemas strict; ID_TYPES, PICKUP_RELATIONS, GATE_PASS_STATUSES, VISITOR_RETENTION_DAYS=180, VISITOR_PRIVACY_NOTICE exported. Validation: hostStaffId or meetingWith required; idType and idLast4 both or neither; phone uses phoneIN (6-9 prefix); idLast4 trims/uppercases to [0-9A-Z]{4}; GatePassCreateSchema enforces exactly one of guardianId/pickupPersonId. PickupRelation and GatePassStatus schemas match task rules.
Tests run: pnpm test tests/unit/visitors-schemas.test.ts → 46 passed
Tests not run and why: Integration (T2 migration not ready); DB tests (T2 owns); E2E (Workstream D).
Limitations / honesty label: Schemas validate syntax only; DB constraints (unique phone per student, FK binding to institution, state transitions) enforced at T2+T4/T5/T6 action layer. No honesty badge needed.
Security / integration risks: None; schemas only. Relative `.ts` imports safe for seed scripts.
Follow-ups: T4 visitor log actions depend on these schemas; T5, T6, T7, T8 depend. T2 DB test will exercise schema + trigger logic together.
New dependencies (justification): none
Assumptions made: phoneIN is already exported from src/lib/schemas/common.ts (confirmed); isoDate validation matches YYYY-MM-DD; uuid used as per transport module pattern.
