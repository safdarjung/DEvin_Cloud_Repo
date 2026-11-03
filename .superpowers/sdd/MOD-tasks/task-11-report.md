Packet: MOD-T11 Jobs + channels
Files changed: src/modules/jobs/registry.ts (JOB_MODULES), src/modules/jobs/runner.ts (dispatch gate),
  src/modules/notifications/service.ts (moduleOffChannels), src/modules/core/actions.ts (inviteMember),
  tests/unit/jobs-runner.test.ts (fakeAdmin extended + 2 tests), tests/db/module-jobs-channels.test.ts (new)
Behavior: JOB_MODULES maps 6 batch-2 job types -> module; runner.dispatch checks it (Object.hasOwn) +
  job.institution_id, reads institutions.settings, disabled -> succeeds with no handler call. service.ts
  drops email/sms from channels when their module is off. inviteMember email send gated by
  isModuleEnabled(ctx,"email"), else "simulated". No new deps/migration.
Tests run: pnpm test tests/unit/jobs-runner.test.ts -> 29 pass. pnpm test:db
  tests/db/module-jobs-channels.test.ts tests/db/jobs.test.ts tests/db/notifications-email-channel.test.ts
  tests/db/member-invite-actions.test.ts -> 31 pass (6+5+15+5). tests/db/notify-announcement.test.ts
  (regression check, not in ACCEPT) -> 5 pass. pnpm lint clean. pnpm typecheck: zero errors in touched files
  (pre-existing errors remain in other packets' files: admissions/exams/website pages missing
  requireModule, calendar/facilities/lifecycle/transport actions missing module: — not touched by T11).
Tests not run: none skipped; no db:reset/seed/db:types used (non-owner).
Limitations / honesty label: n/a (no UI/badge surface touched).
Security / integration risks: dispatch gate adds one extra institutions SELECT per gated job type;
  negligible load, no new write path.
Follow-ups: none new; pre-existing T6-T9 `module:` gaps and T5 requireModule gaps are other tasks' scope.
New dependencies: none.
Assumptions made: finance.fee_reminder added to JOB_MODULES per packet spec though no handler/JobType
  exists yet for it (harmless Partial<Record<string,...>> row, forward-correct for when it lands).
