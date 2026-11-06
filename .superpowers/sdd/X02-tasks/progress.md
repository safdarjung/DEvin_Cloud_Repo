# SDD ledger — plan: docs/planning/fabric/06-backend-packets/X02-tasks.md
Spec: owner directive 2026-11-02 (extension X02 "Certificates + student ID cards", plug-and-play module `certificates`, People & HR, default on). Rulings in task-file header.
Prereqs merged before T2: MOD (0084, catalog, `module` field); M14 T2–T6 (0076, exit_student, lifecycle.withdraw); M11 T9–T10 (escapeHtml, src/lib/http/html.ts, ?format=html).
Routing: T1 haiku none [] ; T2 sonnet exclusive [1] ; T3 sonnet exclusive [2] ; T4 haiku none [] ; T5 haiku none [4] ; T6 haiku none [5] ; T7 sonnet tests [1,3,4] ; T8 sonnet tests [1,3,4,5] ; T9 sonnet tests [6,8] ; T10 sonnet tests [7,8,9] ; T11 sonnet exclusive [3] ; T12 haiku none [10,11]
Migration: 0091 `certificates` (claimed in 10-backlog-index §3; the directive named 0086, held by X03; 0087–0090 held by X04–X07). T2/T3/T11 exclusive: run them one at a time. Commit T1 together with T2 (the module drift test is red in between).
Planner rulings beyond the directive:
- TC serial = M14 `tc_no` (no second TC series); one TC certificate per lifecycle event, and a repeat call is idempotent.
- Serials `BON/{YYYY}/{SEQ:5}` and `CHR/{YYYY}/{SEQ:5}`; the default pattern is merged into settings.numbering when missing (M14 precedent).
- One permission `certificate.manage` (owner/principal/admin/admissions). Staff-only RLS; no guardian copy.
- ID-card photo = documents kind `photo`, embedded as a data URI only when ≤ 50 KB. This respects the Vercel 4.5 MB response cap and the Indian 20–50 KB form-photo norm. The CSP gains `img-src data:`.
- No logo upload (it would need a documents `institution` entity type); a monogram is shown instead.
- `app.module_enabled` re-create: copy from the highest merged definition; extension migrations merge in number order.
## Tasks
(none started)
