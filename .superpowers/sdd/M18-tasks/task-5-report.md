Packet: M18-T5 Ops docs
Files changed: `11-operations.md` §1, §6, §11; `12-decision-log.md` §3 (DBT-10 + 2 new rows); `.env.example` (2 env names)
Behavior: §1 adds `RESTORE_DB_URL` and `RESTORE_ALLOW_REMOTE_HOST`. §6 rewritten: backup scope (managed.sql, no storage bytes, no cron/vault), RPO 24h/RTO 2h, local commands (`pnpm db:backup`, `db:restore`, `db:drill`), hosted drill & restore steps exact. Drill log table: local row filled from T4 timings (backup 16.3s, stack 49.6s, restore 11.4s, test:db 1648s, stop 6.9s, total 1732s ≤ 30m bar). §11 updated to platform backups owner decision. DBT-10 closed: scripts done, RPO/RTO defined, drill passing. Added DBT-81 (storage bytes off-platform) and DBT-82 (owner-run hosted backups).
Tests run: `pnpm lint` (no code touched) → clean.
Honesty label: commands match T2–T4 signatures; no secret values.
