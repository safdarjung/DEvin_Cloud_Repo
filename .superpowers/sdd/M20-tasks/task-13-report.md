Packet: M20-T13 Seed: paper units + computed mastery

Files changed:
- `scripts/seed/sections/exams.ts` — `buildPapersAndMarks` gains `sectionById`/`unitSeqs` params; sets `exam_papers.unit_ids` per paper (HY-2026 → units [1,2], PT2-X → unit [3]) of the paper's own grade+subject.
- `scripts/seed/sections/mastery.ts` (new) — calls `admin.rpc("compute_mastery", { p_institution_id })`, throws on error.
- `scripts/seed/index.ts` — registers `mastery` section right after `exams`.
- `tests/db/seed-mastery.test.ts` (new) — 5 tests.

Behavior implemented: every HY-2026/PT2-X exam_paper row now maps to its grade+subject curriculum units via deterministic uuidV5 ids (no extra DB round trip); seed runs `compute_mastery` once after exams.ts finishes.

Tests run: `DEMO_RESET_ALLOWED=true pnpm db:reset` (clean, mastery section 3.6s, counts unchanged) → `pnpm test:db tests/db/seed-mastery.test.ts` 5/5 pass → `pnpm test:db tests/db/seed-determinism.test.ts` 1/1 pass (full reset+reseed twice, fingerprints match) → `pnpm lint` (4 files) clean → `pnpm typecheck` clean.

Tests not run and why: none — all packet ACCEPT commands ran.

Limitations / honesty label: none — no UI surface in this task.

Security / integration risks: none new. `compute_mastery` already service_role-only (T5); seed's `ctx.admin` is that same client.

Follow-ups: none new.

New dependencies: none.

Assumptions made: PT2-X/HY-2026 unit_ids computed via uuidV5 directly (same formula academics.ts used to create the curriculum_unit rows), not re-queried from the DB — exact-match verified by test joining on `(grade_id, subject_id, sequence)`.
