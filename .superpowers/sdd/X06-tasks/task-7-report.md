Packet: X06-T7 HTML renderers (Haiku, pure)

Files changed:
- src/modules/exam-seating/html.ts (new)
- tests/unit/exam-seating-html.test.ts (new)

Behavior implemented: `renderSeatingChartHtml(chart: SeatingChart): string` — one `.page` per room with seats (plan room order), header school/exam/local date+time/room/"Version <n>", table seat·roll·student·admission·class, footer count; "Superseded — do not use" banner only when `!isCurrent`. `renderAdmitCardsHtml(cards: AdmitCard[]): string` — one A4 `.page` per student: school, "Admit Card", exam, student/admission/roll ("—" when null)/class, paper table `YYYY-MM-DD (Ddd)`, `start–end`, subject, `room, Seat n` or "To be announced"; fixed 3 instructions; "Class Teacher"/"Principal" signature lines. Both: `<!doctype html>`, `<html lang="en">`, `<title>`, inline `<style>` with `@page { size: A4; margin: 12mm }` + `.page { break-after: page }`, every string through M11 `escapeHtml`; no script/img/URL. Imports: `escapeHtml` + `import type` only.

Tests run: `pnpm test tests/unit/exam-seating-html.test.ts` → 9 passed (1 file). `pnpm lint` → clean. `pnpm typecheck` → 0 errors.

Tests not run and why: none (pure functions; no DB).

Limitations / honesty label: print = browser print / Save as PDF; no PDF generation, no photo/logo/QR (CSP `default-src 'none'`). UI pass must label it so (rule 7).

Security / integration risks: XSS covered by `escapeHtml` on every interpolated string (test asserts `<script>` name escaped in both). Numbers (`seatNo`, `versionNo`, `rollNo`) interpolated raw — typed `number`. T8 wires these into `examSeating.chartHtml` / `admitCardsHtml`.

Follow-ups: none.

New dependencies (justification): none.

Assumptions made: rooms with zero seats are skipped (ruling: "one page per room that has seats"). Room set but `seatNo` null prints "Seat —" (not expected from T8). Weekday comes pre-formatted from T4 `AdmitCardPaper.weekday`.
