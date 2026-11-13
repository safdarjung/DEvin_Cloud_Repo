# 15 — Learning & AI Examination System: audit and phased plan

Status: proposed, 2026-11-12. Source brief: owner's "NCERT Learning & AI Examination System" master prompt.
Rule: extend what exists; never duplicate a module. Migrations from 0146 upward, claimed on the sync channel before writing.

## 1. Audit — what exists today

| Area | Status | Evidence |
|---|---|---|
| Grades, subjects, flat curriculum units | built | `curriculum_units` (0005:157); no topics/subtopics, no syllabus version |
| Board | partial | free-text `institutions.board` only (0002:17) |
| NCERT catalogue (391 books, link-out) | built | global `ncert_textbooks` (0139:130); helpers `textbooks/ncert.ts`, `catalogue.ts` |
| School book mapping (NCERT or custom) | built | `subject_textbooks` (0139:170), chapter titles as jsonb; `curriculum_unit_chapters` 1 unit → 1 chapter (0139:262) |
| Edition / ISBN / rights / licence | missing | only `verified`, `retrieved_on`; rights live in a SQL comment (0139:4-10) |
| School textbook PDF upload | built | private `tenant-docs` bucket, 50 MB, %PDF- check, 60 s signed reads (`textbooks/files.actions.ts`) |
| Teacher/student materials, resources | built | `curriculum_materials` (0139:369) with review flow; `resources` (0131:96) |
| Text extraction, OCR, DOCX, chunking, page refs | missing | only a regex page count (`lib/ai/file-input.ts:49`) |
| Search (full-text or semantic) | missing | no tsvector, pg_trgm, pgvector |
| AI reading textbooks | partial | whole PDF sent to Gemini per request, capped 10 MB / 30 pages; most books unreadable |
| Question bank | basic | `question_bank` (0073:21): 4 types, difficulty, marks, answer, unit link, teacher-scoped RLS |
| Bank workflow (status, AI flag, explanation, marking scheme, outcome, source page, version, usage) | missing | — |
| Bank actions: duplicate, approve, import/export, collections, dedupe | missing | only create/update/archive |
| AI paper builder | partial | `/api/ai/question-paper` fills a blueprint; result never saved; prompt sees unit title only |
| Paper entity (sections, items, snapshot, versions) | missing | `exam_papers` = marks-entry rows only (0009:74) |
| Print/PDF | pattern exists | HTML + `@media print` (report cards, certificates, admit cards); none for question papers |
| Exam controller role | built | `exam_controller`, `exam.manage`, `question.manage`, `app.exam_write_roles()` |
| Formal online exams (attempts, per-answer, server timer, windows, limits) | missing | practice/study quizzes only; localStorage timer |
| Server-held answer keys for online tests | missing | practice keys come from the client (fakeable, 0103) |
| Per-question marks / question analytics | missing | `marks` = one total per paper |
| Subjective evaluation, AI-suggested marks with approval | missing | assignments have `grade_submission`; no exam flow |
| Results, publication, rechecks, guardian visibility | built | `results`, `publish_exam_results`, recheck flow |
| Chapter mastery, weak units, revision packs | built (coarse) | `mastery_snapshots`, `study/weak-units.ts`, `RevisionPack` |
| Teacher–section–subject scope | built | `subject_assignments`, `my_taught_section_subjects()` |
| Jobs framework (for extraction) | built | `src/modules/jobs` |

## 2. Fixed constraints

- **NCERT copyright.** Owner ruling in 0139: NCERT PDFs are linked, never stored or fetched. The brief agrees. Extraction runs only on school-uploaded files whose rights field says the school may store them.
- **AI boundary (rule 6).** AI writes drafts only. Generated questions land as `draft`; AI-suggested marks are suggestions a teacher approves. AI never writes marks or results.
- **Immutable history (rule 5).** Published papers are frozen versions. Final marks still flow through `enter_marks` and `results`.
- **Two-layer auth (rule 2).** RLS plus `requirePermission` in every action. New permissions go in `permissions.ts` only.

## 3. Phases

Each phase ships migrations with RLS, actions, UI, DB tests, security tests and an E2E journey before the next one starts.

### Phase 1 — Foundation (extend bank + curriculum)
- `curriculum_topics` (unit → topic → subtopic, via `parent_id`).
- Textbook metadata: edition, year, ISBN, board, rights status, permitted use, source on `subject_textbooks` and on uploaded files.
- `question_bank` gains:
  - status (`draft`, `in_review`, `approved`, `rejected`, `archived`), origin (`manual`, `ai`, `import`), model;
  - explanation, marking scheme, learning outcome;
  - topic, source textbook, chapter and page;
  - version plus `parent_id`.
- More question types: multi-select, fill-in, match, very short, case-based, assertion–reason, numerical, passage, diagram. The answer shape per type is checked in Zod and in SQL.
- New `question.approve` permission. Approve/reject, duplicate, CSV import through the existing imports module, CSV export, and `question_collections`.
- Near-duplicate warning using `pg_trgm` similarity.
- Usage history derived from paper items (Phase 3), not stored twice.

### Phase 2 — Content processing and grounded AI
- Extraction job: text PDFs are parsed page by page; scanned pages go through the AI gateway for OCR.
- New table `content_chunks`: file, page from/to, heading, text, tsvector.
- Extraction status and errors are tracked, and an admin can correct the text.
- Full-text search by keyword, chapter and topic. Semantic search (pgvector) is deferred until an embedding provider is chosen.
- AI question generation retrieves only the matching chunks and cites file and page. If the source is too thin, it says so instead of inventing a reference. Output saves as `draft`.
- Chapter summaries come from the chunks.

### Phase 3 — Paper builder and print
- New tables:
  - `question_papers`: academic year, grade, section, subject, exam type, date, duration, total and pass marks, instructions, negative marking, status;
  - `question_paper_sections`;
  - `question_paper_items`: a snapshot of the question text, answer and marks, plus the source `question_id`;
  - `question_paper_versions`: a frozen copy on every approve or publish.
- Configurable blueprints (type × count × marks × difficulty × chapter weight) and saved templates. Nothing is hard-coded to CBSE.
- `app.validate_paper()` checks marks totals, counts, coverage and duplicates. A paper cannot reach `ready` while totals mismatch.
- The editor supports reorder, replace with an AI suggestion, internal choice, passages and images.
- Status flow: draft → review → approved by exam controller or principal → published. A paper links to an `exam_papers` row so offline marks entry keeps working.
- Print HTML for the question paper, answer key and marking scheme, with school branding. Sets A/B use a deterministic shuffle. This follows the existing `@media print` pattern.

### Phase 4 — Online examinations
- New tables:
  - `online_tests`: paper version, window, duration, attempt limit, result and answer release policy;
  - `test_attempts`: server-side `started_at` and deadline;
  - `test_responses`: one row per question, autosave upsert, locked on submit.
- Answer keys never reach the client.
- Objective answers are auto-marked in SQL. Subjective answers go to a marking queue, where AI-suggested marks and feedback are stored as suggestions and a teacher approves them.
- Per-question marks roll up to the total. The total goes through `enter_marks` and on to the existing results publication.
- Student runner: timer from the server deadline, question palette, mark for review, saved/unsaved state, submit confirmation, recovery after a reload. Everything is audit-logged.

### Phase 5 — Learning intelligence
- Question-wise and chapter/topic-wise analytics from per-question marks. Common mistakes and difficult questions.
- Mastery fed by per-question data. Student recommendations.
- Practice moves to approved bank questions with server-held keys, which fixes the fakeable practice score.

## 4. Open decisions for the owner
1. Extraction stack. Option A: add `unpdf` for text PDFs and use Gemini OCR only for scanned pages. Option B: Gemini only, no new dependency, but every page goes to the cloud.
2. DOCX/PPTX uploads: in scope for Phase 2 (one more parser), or later?
3. Semantic search: needs an embedding provider and `pgvector`. Recommend deferring until full-text search proves short.

## 5. Risks
- Large surface: about 10 new tables and 3 RPCs per phase. Each phase needs an Opus review for RLS and AI-gateway work.
- Hosted pushes of migrations 0146+ need owner go-ahead per batch.
- The UI session (friend) owns `page.tsx` and components. Coordinate handoffs on the sync channel.
