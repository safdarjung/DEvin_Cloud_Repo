Packet: M19-T20 Approvals branch `insight`
Files changed: none (blocked before edit)
Behavior implemented: none
Tests run: none
Tests not run and why: cannot write TEST FIRST — target function does not exist
Limitations / honesty label: n/a
Security / integration risks: none introduced
Follow-ups: M16-T5 must land first (see blocker)
New dependencies: none
Assumptions made: none

BLOCKED — missing prerequisite, not a 2-attempt root-cause case:
Task 20 adds an `insight` branch to `pendingApprovals` in
`src/modules/core/approvals.queries.ts`, after its existing leave/recheck
branches, and extends `tests/db/approvals-pending.test.ts`. Neither file
exists. M16 ("Dashboards on real data + approvals", `core.approvals.pending`,
migration 0078, `ApprovalRow`) is listed as a merged prereq in the M19-T20
packet header but was never implemented on any branch: checked `main`,
`lane-d`, `git log --all` — no M16 commit, no `approvals.queries.ts`, no
`20261028000078_*.sql`. Only M08's single-kind `pendingLeaveApprovals`
(`src/modules/people/hr.queries.ts`) exists.
Building M16-T5 from scratch (new migration 0078, aggregator with
leave+recheck branches, query-defs registration, base test file) is outside
this packet's FILES and risks collision with shared registries other lanes
are editing concurrently. Needs human/lead call: build M16-T5 first (own
packet) or re-scope T20.
