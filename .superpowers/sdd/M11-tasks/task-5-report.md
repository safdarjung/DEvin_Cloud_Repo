Packet: M11-T5 Action `exam.paper.schedule`
Files changed: src/modules/exams/schemas.ts (SchedulePapersSchema), src/modules/exams/actions.ts (schedulePapers), tests/db/exam-schedule-actions.test.ts (new), tests/security/escalation.test.ts (C-03 fixture)
Behavior: exam.manage-gated action updates exam_papers.scheduled_at/duration_minutes/room_id, derives held_on from scheduledAt via T6's institutionTimeZone/localParts; scheduledAt:null clears time/duration/room, keeps held_on; published exam -> invalid_state; room pre-checked against institution; no overlap rejection (reporting is T6/T7).
Lane B ruling applied: no `module` field on defineAction (MOD not merged yet).
Tests run: pnpm test:db tests/db/exam-schedule-actions.test.ts -> 7/7 pass; pnpm test:security tests/security/escalation.test.ts -> 902/902 pass; pnpm lint -> clean; pnpm typecheck -> clean for touched files.
Tests not run: full test:db/db:reset/seed (brief forbids; not my DB ownership here).
Not run as specified: pnpm test tests/unit/action-names-unique.test.ts fails, but on query registration (transport.forStudent/transport.routes missing) — unrelated to this task, pre-existing from concurrent transport module work (untracked src/modules/transport/), not touched by me.
Other pre-existing typecheck errors (not mine, not fixed): src/modules/lifecycle/actions.ts (7 errors, concurrent lifecycle module).
Limitations / honesty label: none (no UI, no simulated channel).
Security/integration risks: none new; room/exam/paper ownership all re-checked against ctx.institution.id before write.
Follow-ups: none beyond M11 plan (T7 wires scheduleConflicts/schedule queries on top of this).
New dependencies: none.
Assumptions: teacher lacking `exam.manage` is blocked at the permission layer, so the 42501-RLS "outside your teaching scope" mapping in rulings' ErrorCode table is dead code for this action and was not added (YAGNI) — no test path reaches it.
