Packet: M11-T10 `?format=html` + `exams.reportCardHtml`
Files changed: src/lib/http/html.ts (new); src/app/api/v1/query/[name]/route.ts (edit: format=html branch); src/modules/exams/query-defs.ts (edit: reportCardHtmlQuery def); tests/unit/html-response.test.ts (new); tests/db/api-query-route.test.ts (edit: smoke sample)
Behavior implemented: toHtmlResponse mirrors toCsvResponse — error passthrough, null->404 not_found, {html}->200 text/html + 5 security headers, else->422. exams.reportCardHtml (perm exam.result.read) = getCurrentResult + getResultRemark -> renderReportCardHtml (T9) or null. Route GET branches format=csv|html off the already-dispatched result.
Tests run: pnpm test tests/unit/html-response.test.ts -> 4 pass; pnpm test:db tests/db/api-query-route.test.ts -> 7 pass (incl. owner smoke, all registered queries incl. new one); pnpm lint (touched files) clean; pnpm typecheck (whole repo) clean.
Tests not run and why: tests/db/question-bank-*, escalation/security suites, full test:db — not this task's files per brief (non-owner, no db:reset/seed/db:types).
Limitations / honesty label: English only, print-view only (F-EXM-09 limited, set by T9/T12, unchanged here).
Security / integration risks: CSP/no-store/nosniff/referrer headers set per ruling; html body is T9's escapeHtml-built string, no new escaping surface here.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: T7 (exams.schedule/query-defs.ts) and T9 (report-card-html.ts) already landed in this tree — confirmed present, read not edited beyond appending.
