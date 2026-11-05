// X06-T7 — pure HTML renderers for seating charts and admit cards.
// Print = browser print / Save as PDF. No scripts, images or external URLs
// (served under M11's `default-src 'none'` CSP). Every interpolated string escaped.
import { escapeHtml } from "../exams/report-card-html";
import type { AdmitCard, SeatingChart } from "./schemas";

const STYLE = `
    @page { size: A4; margin: 12mm }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 0 }
    .page { break-after: page; padding: 4mm 0 }
    .page:last-child { break-after: auto }
    h1 { font-size: 18px; margin: 0 0 2px 0 }
    h2 { font-size: 15px; margin: 0 0 8px 0 }
    .meta { margin: 0 0 10px 0; color: #333 }
    .banner { border: 2px solid #b00; color: #b00; font-weight: bold; padding: 6px; margin: 0 0 10px 0; text-align: center }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 }
    th, td { border: 1px solid #999; padding: 4px 6px; text-align: left }
    th { background: #eee }
    .footer { margin-top: 10px; font-size: 11px; color: #333 }
    .sign { display: flex; justify-content: space-between; margin-top: 36px }
    .sign span { border-top: 1px solid #111; padding-top: 4px; width: 40% ; text-align: center }
`;

function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

const rollNoText = (rollNo: number | null) => (rollNo === null ? "—" : String(rollNo));

export function renderSeatingChartHtml(chart: SeatingChart): string {
  const banner = chart.isCurrent ? "" : `<div class="banner">Superseded — do not use</div>\n`;
  const pages = chart.rooms
    .filter((r) => r.seats.length > 0)
    .map(
      (r) => `<section class="page">
${banner}<h1>${escapeHtml(chart.institutionName)}</h1>
<h2>${escapeHtml(chart.examName)}</h2>
<p class="meta">${escapeHtml(chart.localDate)} · ${escapeHtml(chart.localTime)} · Room: ${escapeHtml(r.room.name)} · Version ${chart.versionNo}</p>
<table>
<thead><tr><th>Seat</th><th>Roll No</th><th>Student</th><th>Admission No</th><th>Class</th></tr></thead>
<tbody>
${r.seats
  .map(
    (s) =>
      `<tr><td>${s.seatNo}</td><td>${rollNoText(s.rollNo)}</td><td>${escapeHtml(s.studentName)}</td><td>${escapeHtml(s.admissionNo)}</td><td>${escapeHtml(s.sectionLabel)}</td></tr>`
  )
  .join("\n")}
</tbody>
</table>
<p class="footer">${r.seats.length} students seated in ${escapeHtml(r.room.name)}</p>
</section>`
    )
    .join("\n");
  return htmlDocument(`${chart.examName} — Seating chart`, pages);
}

export function renderAdmitCardsHtml(cards: AdmitCard[]): string {
  const pages = cards
    .map(
      (c) => `<section class="page">
<h1>${escapeHtml(c.institutionName)}</h1>
<h2>Admit Card — ${escapeHtml(c.examName)}</h2>
<p class="meta">Student: ${escapeHtml(c.studentName)} · Admission No: ${escapeHtml(c.admissionNo)} · Roll No: ${rollNoText(c.rollNo)} · Class: ${escapeHtml(c.sectionLabel)}</p>
<table>
<thead><tr><th>Date</th><th>Time</th><th>Subject</th><th>Room &amp; seat</th></tr></thead>
<tbody>
${c.papers
  .map(
    (p) =>
      `<tr><td>${escapeHtml(p.date)} (${escapeHtml(p.weekday)})</td><td>${escapeHtml(p.start)}–${escapeHtml(p.end)}</td><td>${escapeHtml(p.subject)}</td><td>${
        p.room === null ? "To be announced" : `${escapeHtml(p.room)}, Seat ${p.seatNo ?? "—"}`
      }</td></tr>`
  )
  .join("\n")}
</tbody>
</table>
<ul class="footer">
<li>Bring this card to every paper.</li>
<li>Reach the exam room 15 minutes before the start.</li>
<li>Mobile phones and smart watches are not allowed.</li>
</ul>
<div class="sign"><span>Class Teacher</span><span>Principal</span></div>
</section>`
    )
    .join("\n");
  const title = cards[0] ? `${cards[0].examName} — Admit cards` : "Admit cards";
  return htmlDocument(title, pages);
}
