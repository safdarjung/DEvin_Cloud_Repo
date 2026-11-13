// Phase 3 — printable question paper, answer key and marking scheme. Pure:
// no data access. Every user value goes through esc() (escapeHtml, then ^
// powers to superscripts); the print route's CSP blocks scripts as a second wall.
import { withSuperscripts } from "@/lib/superscript";
import { escapeHtml } from "@/modules/exams/report-card-html";
import { seededShuffle, sectionMarks, slots } from "@/modules/question-papers/paper-math";
import type { PaperDetail, PaperItem } from "@/modules/question-papers/queries";
import type { PrintKind, PrintSet } from "@/modules/question-papers/schemas";

const esc = (s: string | null | undefined): string => withSuperscripts(escapeHtml(s ?? ""));
const fmt = (n: number): string => String(Math.round(n * 100) / 100);
const letter = (i: number): string => String.fromCharCode(97 + i);

const ASSERTION_CHOICES = [
  "Both A and R are true, and R is the correct explanation of A.",
  "Both A and R are true, but R is not the correct explanation of A.",
  "A is true, but R is false.",
  "A is false, but R is true.",
];

interface PrintItem extends PaperItem {
  /** Display order of options for this set (mcq / multi_select). */
  shownOptions: string[] | null;
}

interface PrintSlot {
  no: number;
  items: PrintItem[];
}

const STEM_TYPES = new Set(["passage", "case_based"]);

/** Blocks that move together when shuffled: a passage/case stem slot followed by its sub-question slots. */
function stemBlocks(grouped: PaperItem[][]): PaperItem[][][] {
  const stems = new Set(grouped.flatMap((slot) => slot.filter((i) => STEM_TYPES.has(i.type) && i.sourceQuestionId).map((i) => i.sourceQuestionId)));
  const childOf = (slot: PaperItem[]) => slot.map((i) => i.stemSourceId).find((s) => s && stems.has(s));
  const blocks = grouped.filter((slot) => !childOf(slot)).map((slot) => [slot]);
  for (const block of blocks) {
    const stemId = block[0].find((i) => STEM_TYPES.has(i.type))?.sourceQuestionId;
    if (stemId) block.push(...grouped.filter((slot) => childOf(slot) === stemId));
  }
  return blocks;
}

/**
 * Set A prints the paper as built. Other sets shuffle question order inside
 * each section (an OR pair stays together, a passage/case stem keeps its
 * sub-questions right after it) and MCQ options, seeded by paper id + set
 * letter, so a reprint gives the same paper and the same key.
 */
export function arrangeSet(paper: PaperDetail, set: PrintSet): { section: PaperDetail["sections"][number]; slots: PrintSlot[] }[] {
  let no = 0;
  return paper.sections.map((section) => {
    const grouped = slots(section.items);
    const ordered = set === "A" ? grouped : seededShuffle(stemBlocks(grouped), `${paper.id}:${set}:${section.id}`).flat();
    return {
      section,
      slots: ordered.map((slot) => ({
        no: ++no,
        items: slot.map((item) => {
          const opts = Array.isArray(item.options) ? (item.options as string[]) : null;
          const shown = opts && set !== "A" ? seededShuffle(opts, `${paper.id}:${set}:${item.id}`) : opts;
          return { ...item, shownOptions: shown };
        }),
      })),
    };
  });
}

function questionBody(item: PrintItem): string {
  const parts = [`<div class="body">${esc(item.body)}</div>`];
  if (item.shownOptions) {
    parts.push(`<ol class="opts">${item.shownOptions.map((o, i) => `<li><span>(${letter(i)})</span> ${esc(o)}</li>`).join("")}</ol>`);
  } else if (item.type === "match") {
    const m = item.options as { left: string[]; right: string[] } | null;
    if (m) {
      const rows = Math.max(m.left.length, m.right.length);
      parts.push(
        `<table class="match"><tr><th>Column A</th><th>Column B</th></tr>${Array.from({ length: rows }, (_, i) => `<tr><td>${i + 1}. ${esc(m.left[i])}</td><td>${m.right[i] === undefined ? "" : `${letter(i)}. ${esc(m.right[i])}`}</td></tr>`).join("")}</table>`,
      );
    }
  } else if (item.type === "assertion_reason") {
    const ar = item.options as { assertion: string; reason: string } | null;
    if (ar) {
      parts.push(`<div><b>Assertion (A):</b> ${esc(ar.assertion)}</div><div><b>Reason (R):</b> ${esc(ar.reason)}</div>`);
      parts.push(`<ol class="opts">${ASSERTION_CHOICES.map((c, i) => `<li><span>(${letter(i)})</span> ${c}</li>`).join("")}</ol>`);
    }
  } else if (item.type === "true_false") {
    parts.push(`<div class="hint">(True / False)</div>`);
  }
  return parts.join("");
}

function keyText(item: PrintItem): string {
  if (item.type === "mcq" && item.shownOptions) {
    const i = item.shownOptions.indexOf(item.answer ?? "");
    return i >= 0 ? `(${letter(i)}) ${esc(item.answer)}` : esc(item.answer);
  }
  if (item.type === "multi_select" && item.shownOptions && Array.isArray(item.answerKey)) {
    const opts = item.shownOptions;
    return (item.answerKey as string[]).map((a) => `(${letter(opts.indexOf(a))}) ${esc(a)}`).join(", ");
  }
  if (item.type === "match" && Array.isArray(item.answerKey)) {
    return (item.answerKey as number[]).map((r, l) => `${l + 1}-${letter(r)}`).join(", ");
  }
  if (item.type === "assertion_reason" && item.answer) {
    return `(${letter("ABCD".indexOf(item.answer))})`;
  }
  return esc(item.answer);
}

function slotHtml(slot: PrintSlot, kind: PrintKind): string {
  const marks = Math.max(...slot.items.map((i) => i.marks));
  const alternatives = slot.items.map((item) => {
    if (kind === "paper") return questionBody(item);
    const scheme = kind === "scheme"
      ? `${item.markingScheme ? `<div class="scheme"><b>Marking:</b> ${esc(item.markingScheme)}</div>` : ""}${item.explanation ? `<div class="scheme"><b>Explanation:</b> ${esc(item.explanation)}</div>` : ""}`
      : "";
    return `${kind === "scheme" ? `<div class="body muted">${esc(item.body)}</div>` : ""}<div><b>Answer:</b> ${keyText(item)}</div>${scheme}`;
  });
  return `<li class="q"><span class="no">${slot.no}.</span><div class="qbody">${alternatives.join(`<div class="or">OR</div>`)}</div><span class="m">[${fmt(marks)}]</span></li>`;
}

export interface PaperPrintInput {
  schoolName: string;
  logoUrl: string | null;
  paper: PaperDetail;
  kind: PrintKind;
  set: PrintSet;
}

const TITLES: Record<PrintKind, string> = { paper: "", key: "Answer key", scheme: "Marking scheme" };

export function renderPaperHtml({ schoolName, logoUrl, paper, kind, set }: PaperPrintInput): string {
  const arranged = arrangeSet(paper, set);
  const meta = [
    paper.examName ?? paper.examType,
    `Class ${paper.gradeCode}`,
    paper.subjectName,
    paper.examDate,
    paper.durationMinutes ? `Time: ${paper.durationMinutes} min` : null,
    `Max. marks: ${fmt(paper.totalMarks)}`,
    `Set ${set}`,
  ].filter((v): v is string => Boolean(v));
  const sectionsHtml = arranged
    .map(({ section, slots: ss }) => {
      const worth = sectionMarks(section.items, section.chooseCount);
      const attempt = section.chooseCount ? `<div class="hint">Attempt any ${section.chooseCount}.</div>` : "";
      return `<section><h2>${esc(section.title)} <span class="m">[${fmt(worth)}]</span></h2>${kind === "paper" ? `${section.instructions ? `<div class="hint">${esc(section.instructions)}</div>` : ""}${attempt}` : ""}<ol class="qs">${ss.map((s) => slotHtml(s, kind)).join("")}</ol></section>`;
    })
    .join("");
  const negative = paper.negativeMarking > 0 && kind === "paper" ? `<li>${fmt(paper.negativeMarking)} mark(s) will be deducted for each wrong objective answer.</li>` : "";
  const instructions =
    kind === "paper" && (paper.instructions || negative)
      ? `<div class="instr"><b>General instructions</b><ol>${(paper.instructions ?? "").split("\n").filter((l) => l.trim()).map((l) => `<li>${esc(l)}</li>`).join("")}${negative}</ol></div>`
      : "";
  const candidate = kind === "paper" ? `<div class="cand"><span>Name: <i></i></span><span>Roll no.: <i></i></span></div>` : "";
  const logo = logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="">` : "";
  const title = [paper.title, TITLES[kind]].filter(Boolean).join(" — ");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4; margin: 16mm 14mm 18mm; @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 10px sans-serif; } }
body { font: 13px/1.45 "Times New Roman", serif; color: #000; margin: 0 auto; max-width: 780px; padding: 16px; }
header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
.logo { height: 48px; } h1 { font-size: 18px; margin: 4px 0; } .meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 16px; }
.cand { display: flex; gap: 24px; margin: 10px 0; } .cand i { display: inline-block; width: 220px; border-bottom: 1px solid #000; }
.instr { margin: 10px 0; font-size: 12px; } .instr ol { margin: 4px 0; padding-left: 20px; }
h2 { font-size: 15px; margin: 14px 0 4px; display: flex; justify-content: space-between; }
ol.qs { list-style: none; padding: 0; margin: 0; } li.q { display: flex; gap: 6px; margin: 8px 0; break-inside: avoid; }
.no { min-width: 26px; font-weight: bold; } .qbody { flex: 1; } .m { white-space: nowrap; font-weight: normal; }
.body { white-space: pre-wrap; } .muted { color: #444; } .hint { font-style: italic; font-size: 12px; }
ol.opts { list-style: none; padding: 0; margin: 4px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; }
.or { text-align: center; font-weight: bold; margin: 6px 0; } .scheme { font-size: 12px; margin-top: 2px; white-space: pre-wrap; }
table.match { border-collapse: collapse; margin-top: 4px; } table.match td, table.match th { border: 1px solid #000; padding: 2px 8px; text-align: left; }
@media print { body { padding: 0; } }
</style></head><body><header>${logo}<div><b>${esc(schoolName)}</b></div><h1>${esc(title)}</h1><div class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div></header>${candidate}${instructions}${sectionsHtml}</body></html>`;
}
