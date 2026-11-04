# M15-T1 Completion Report

**Packet:** T1 — Permissions `report.schedule`, `data.export`
**Status:** DONE

**Files changed:**
- `/home/safdar/Desktop/projects/coolschool-b/src/lib/auth/permissions.ts` — added two permissions to union; appended to owner, principal, admin (both); accountant (data.export only)
- `/home/safdar/Desktop/projects/coolschool-b/tests/unit/permissions.test.ts` — added two matrix rows to snapshot

**Behavior implemented:**
- `report.schedule` permission granted to owner, principal, admin
- `data.export` permission granted to owner, principal, admin, accountant
- Matrix snapshot validates against 07 §2.2; union member + literal checks green

**Tests run:**
```
pnpm test tests/unit/permissions.test.ts → 18 passed
pnpm test tests/unit/permission-literals.test.ts → 1 passed
```

**Limitations / honesty label:** None (purely permission matrix, no UI/API surface yet).

**Security / integration risks:** None. Permissions are declared only; enforcement is in actions/queries (T10–T11).

**Follow-ups:** Tasks T2–T5 reserve migration 0077, declare these permissions in their action/query handlers.

**New dependencies:** None.

**Assumptions made:** Permission order (alphabetic within role) follows existing convention; matrix row order per task spec.
