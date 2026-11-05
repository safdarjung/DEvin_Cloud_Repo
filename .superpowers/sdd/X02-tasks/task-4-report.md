Packet: X02-T4 Certificates Zod schemas
Files changed: src/modules/certificates/schemas.ts (new); tests/unit/certificates-schemas.test.ts (new)
Behavior implemented:
- CertificateKindSchema; IssueCertificateSchema = discriminatedUnion("kind") of strict bonafide {studentId, purpose trim 3–200} / character {studentId, conduct trim 2–100, purpose? 3–200} / transfer {studentId}.
- CertificateListSchema {studentId?, serialNo? trim 1–60, kind?, limit int 1–100 default 50}; CertificatePrintSchema {certificateId}; IdCardsSchema {classSectionId}; all strict.
- CertificateSnapshotSchema (z.looseObject, keys per rulings; roll_no/admitted_on/board/address nullable; tc = TcSnapshotSchema.nullable()).
- TcSnapshotSchema (z.looseObject) = 0076 exit_student tc_snapshot keys: tc_no, student_name, admission_no, dob, gender, primary_guardian_name?, grade?, section?, academic_year?, admitted_on?, left_on, kind, reason, destination_school?, conduct?, dues_outstanding z.coerce.number(). Inferred types exported.
- Relative `.ts` import of `uuid` from lib/schemas/common (seed-safe), timetable precedent.
Tests run: pnpm test tests/unit/certificates-schemas.test.ts → 35 passed, 0 failed; eslint on both files → clean; pnpm typecheck → exit 0.
Tests not run and why: none required (no DB, no migration).
Limitations / honesty label: none (schemas only). Continued from an interrupted run's partial files; replaced `.passthrough()` with `z.looseObject` (Zod 4.6.7), typed `tc`, added TC pupil fields and per-kind snapshot fixtures.
Security / integration risks: T3 builds the SQL snapshot; if its key set/nullability diverges from CertificateSnapshotSchema the action maps to `internal`. T3 must emit `admitted_on`/`roll_no` as null (not omit) when absent, and `tc` null for non-transfer. `issued_at` in tc is loose (passthrough), not required.
Follow-ups: T5 renderer consumes CertificateSnapshot/TcSnapshot types; T7 action uses IssueCertificateSchema.
New dependencies (justification): none
Assumptions made: enrolment.roll_no nullable (enrolments.roll_no int null); admitted_on nullable for safety though all kinds require ≥1 enrolment; TC `dues_outstanding` may arrive as string via jsonb numeric → coerce.
Other-file lint/type errors: none observed in `pnpm typecheck`; lint run only on touched files.
