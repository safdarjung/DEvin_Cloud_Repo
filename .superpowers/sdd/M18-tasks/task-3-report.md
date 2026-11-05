Packet: M18-T3 scripts/db-restore.ts
Files changed: scripts/db-restore.ts (new), tests/unit/db-restore-cli.test.ts (new)
Behavior implemented: CLI `node scripts/db-restore.ts <backupDir>`. Order: assertRestoreTarget(RESTORE_DB_URL, RESTORE_ALLOW_REMOTE_HOST) → manifest.json + 4 required files present + sha256 match → connect (ssl per isLoopbackHost) → refuse if target `public` has any table → sql.begin: roles/schema/data/managed via tx.unsafe(text).simple(), timed → countsMismatch parity check → `restore: ok <n> tables <ms> ms`. Errors: pg errors print code+message only; guard/fs errors print message only (never the URL).
Tests run: `pnpm test tests/unit/db-restore-cli.test.ts` → 6/6 pass (unset RESTORE_DB_URL; shared-local port 54322 refusal + no password echo; non-loopback host no allow; non-matching allow; guard-before-dir ordering via unresolvable host + missing dir; manifest sha256 mismatch). `pnpm lint` and `pnpm typecheck` (full project) → clean, 0 errors.
Tests not run and why: no case connects to a DB (per task scope — pure/guard logic only); real load path (steps 3-5 against a live stack) proven in T4's drill, not here.
Limitations / honesty label: n/a (ops script, no UI).
Security / integration risks: none new — reuses T1's assertRestoreTarget/redactDbUrl/countsMismatch verbatim; no secrets printed (verified via test asserting absence of injected password in stdout+stderr).
Follow-ups: none.
New dependencies (justification): none (postgres, already installed, used per rulings).
Assumptions made: countsMismatch parity-failure path logs each mismatch line then exits 1 with a generic "parity check failed" message (spec didn't name an exact string for this case, only for shared-local/checksum). manifest.json schema read loosely (only `counts`/`files` fields used); full manifest shape produced by T2.
