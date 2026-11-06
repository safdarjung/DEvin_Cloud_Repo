Packet: T-11 Job `mastery.compute` + sweep port

Files changed:
- src/modules/jobs/handlers/mastery.compute.ts (new)
- src/modules/jobs/types.ts
- src/modules/jobs/handlers/index.ts
- src/modules/jobs/registry.ts
- src/modules/jobs/runner.ts
- tests/unit/jobs-runner.test.ts

Behavior implemented: Job handler `masteryCompute` calls `compute_mastery` RPC; sweep method `enqueueMasteryCompute()` added to RunnerPorts; sweep called once per `runOnceCore` after reports but before insights; registered in `JOB_REGISTRY` and `JOB_MODULES["mastery.compute"] = "mastery"`.

Tests run: `pnpm test tests/unit/jobs-runner.test.ts` → 43 passed

Limitations / honesty label: none

Security / integration risks: none

Follow-ups: M20-T12 (gap detector) will call the handler after compute; other T6+ tasks build on this.

New dependencies: none

Assumptions made: Sweep is placed between reports and insights per existing pattern; handler mirrors report.generate pattern.
