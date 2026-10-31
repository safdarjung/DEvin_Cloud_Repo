# F-BE-07 Fixture Report

Packet: F-BE-07 fixture `success`

**Files:** 
- `src/modules/fabric/demo/success.ts` (fixture implementations)
- `tests/unit/fabric-fixtures/success.test.ts` (test suite)

**Behavior:** 60 students (risk: 70% none, 20% watch, 10% support) with 0–3 gaps each. Support-risk students get support_owner; none-risk have no gaps. 8 intervention plans (one per support-risk student, 3–4 steps, restricted=true). Deterministic PRNG seed 7.

**Tests:** 12/12 pass. Same seed deep-equals, counts verified, every plan's student_id exists in rows and is support-risk.

**Lint/Type:** Clean. Pnpm build succeeds.

**Risk:** None. Deterministic output. No external data.
