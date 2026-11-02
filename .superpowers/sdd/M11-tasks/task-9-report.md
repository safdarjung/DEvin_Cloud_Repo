# M11-T9 Report Card HTML Renderer

**Packet:** M11-T9 Report card HTML renderer (Haiku)

**Files changed:**
- `src/modules/exams/report-card-html.ts` (new, 160 lines)
- `tests/unit/report-card-html.test.ts` (new, 200 lines)

**Behavior implemented:**
Pure HTML renderer with XSS protection. Outputs complete A4-printable HTML5 document with school name, exam, student, admission no, subject table (marks/AB for absent, grade, Pass/Fail), totals, percentage (1 dp), overall grade, attendance %, remark (when provided), corrected date note (when isCorrected=true), and published date. No external assets, no scripts, inline CSS only with @page A4 and @media print rules.

**Tests run:**
- `pnpm test tests/unit/report-card-html.test.ts` → 18 passed
- `pnpm typecheck` → 0 errors
- `pnpm lint src/modules/exams/report-card-html.ts tests/unit/report-card-html.test.ts` → 0 errors

**Test output:** Test Files 1 passed (1); Tests 18 passed (18)

**Limitations / honesty label:** None. Full escape coverage, no print CSS customization beyond A4/12mm margins.

**Security / integration risks:** None. HTML output is a pure string; no side effects, no DB access, type-only import of ResultDetail.

**Follow-ups:** T10 (query route handler) depends on this renderer.

**New dependencies:** None.

**Assumptions made:** resultDetail.publishedAt is ISO8601 string; absent subject has `isAbsent=true` and marks=null; percentage already computed by backend (not recalculated on render).
