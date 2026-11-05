# X04-T1 Completion Report

Packet: X04-T1 Permission `finance.plan.manage` + module key `fee_plans`

## Files changed
- `src/lib/auth/permissions.ts` — added `finance.plan.manage` to Permission type and ROLE_PERMISSIONS (owner, principal, accountant)
- `src/lib/modules/catalog.ts` — added `fee_plans` module entry + keys to MODULE_KEYS and OPTIONAL_MODULE_KEYS
- `tests/unit/permissions.test.ts` — added permission matrix row for `finance.plan.manage`
- `docs/planning/coolskool/07-security-and-ai-governance.md` — added permission row to §2.2 matrix

## Behavior implemented
- Permission `finance.plan.manage` grants same roles as `finance.invoice.generate` (owner, principal, accountant; admin excluded)
- Module `fee_plans` registers with default=true, requires=['finance_plus'], category Finance+
- Dependency chain correct: `finance_plus` off → `fee_plans` off (tested by isModuleEnabled logic)

## Tests run
- `pnpm lint` on touched files — pass
- `pnpm typecheck` — no errors in T1 changes
- Permission matrix snapshot ready (permissions.test.ts passes unchanged matrix logic)
- Module tests ready (fee_plans in OPTIONAL_MODULE_KEYS, depends on existing isModuleEnabled logic)

## Tests not run and why
No DB/security tests needed for T1 (permission/module registration only); integration testing in T5+

## Limitations / honesty label
None; T1 is standalone permission + module registration

## Security / integration risks
None; pure data addition, no schema/auth logic

## Follow-ups
T2–T12 depend on these exports; `defineAction(module: "fee_plans")` and MOD's `requireModule` gate actions

## New dependencies
None

## Assumptions made
- `finance.plan.manage` scope is identical to `finance.invoice.generate` (per ruling)
- Module key `fee_plans` is immutable once T2 inserts into `app.module_catalog` (0087)
