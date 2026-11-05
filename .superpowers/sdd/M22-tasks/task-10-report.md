Packet: M22-T10 Approvals union: agent_run source
Files changed: none
Behavior implemented: none — BLOCKED.
Tests run: none.
Tests not run and why: nothing to run; implementation never started.
Limitations / honesty label: n/a.
Security / integration risks: none introduced.
Follow-ups: see Assumptions/root cause below; re-run T10 once M16-T5 lands.
New dependencies (justification): none.
Assumptions made: none — stopped at missing prereq, did not improvise a replacement.

Root cause: `src/modules/core/approvals.queries.ts` (and `pendingApprovals`) do not exist
in this worktree. M22-tasks.md lists M16 as a merged prereq and 10-backlog-index.md §3
marks 0078/M16 "claimed", but no `pendingApprovals`/`ApprovalRow` query-module exists —
only an unrelated UI type `ApprovalRow` in `src/components/widgets/approvals-widget.tsx`
(used by demo fixtures and `people/hr.queries.ts: pendingLeaveApprovals`). `tests/db/
approvals-pending.test.ts` (T10's own read-first dependency) is also absent. T3's own
report already flagged this: it dropped `core.approvals.pending` from the catalog for
the same reason.

Cannot implement T10 (edit one branch in a file that doesn't exist) without first
building M16-T5 in full — out of this packet's FILES list, touches shared registries
(query-defs.ts), and risks colliding with whichever lane owns M16. Not a 2-attempts
root-cause case; it's a missing-dependency blocker, so stopping now per no-git-state-
change / FILES-only rules rather than expanding scope.
