# SDD ledger — plan: docs/planning/fabric/06-backend-packets/M02-tasks.md
Spec: docs/planning/fabric/07-master-plan-v1-v2.md §2 D41, §3 M2 (binding). Rulings from M01 ledger carry over (main-only, controller commits, controller per-task review, one security review per milestone).
## Pre-flight
| Pair/Task | Interface | Finding |
|---|---|---|
| T1→T3..T7 | defineQuery, getRegisteredQueries, getQueryMeta | ok |
| T2→T7 | readPostBody, dispatchCall, listResponse | ok |
| T3→T4..T6 | query-defs rules live in T3 text | Ruling: T4–T6 dispatch also points at task-3 brief |
| T3..T6 → T8 | permissions per query | guardian holds finance.read → Ruling: T8 forbidden case uses jobs.listAttentionJobs (patched before dispatch) |
| T4..T6 | 4th file all-queries.ts | Ruling: allowed, import lines only |
## Tasks
Task 1: complete (commits f342b2f..2e7cdb4, review clean)
Task 2: complete (commits ..1f387f3, review clean; controller renamed log string to '/api/v1 dispatcher failed')
Task 3: complete (commits ..0e3b5ec). Ruling: listTeachableSections/listSectionSubjects gate academics.read not ai.generate — structure read, all roles hold it; RLS filters rows — cost if wrong: accountant/exam_controller can list sections (non-sensitive).
Ruling: T4–T6 batched into one implementer — same-shape mechanical wrapping, saves two ramp-ups — cost if wrong: one larger diff to review.
Tasks 4-6: complete (commits ..318aceb). Ruling: API gates use domain key, not a page's looser gate — attendance summary→attendance.read, invoicesForStudent→finance.read, listAcademicYears→academics.read; listFeeStructures stays student.read (institution price list). Page gap logged DBT-43. student-study.queries.ts (3 fns) missed by plan → folded into T7.
Task 7: complete (commits ..e774592, review clean)
Task 8: complete (commits ..7b65b0b, review clean)
Security review (Sonnet): 0 CRIT, 2 HIGH, 1 MED, 1 LOW.
Ruling: HIGH x2 (academics.read on teachable sections/subjects) rejected — 07 §2.2 gives academics.read to all roles; payload is structure (names, class_teacher_id), RLS-filtered — real defect was stale ai.generate comments, fixed.
Ruling: MED listFeeStructures=student.read kept — institution fee price list, shown to prospective parents anyway — cost if wrong: guardians/students can list fee structures.
Ruling: LOW GET puts input in URL — accepted; document "use POST for search terms/PII inputs" in D41 note.
M02 DONE 1fe3756 pushed; gate green
