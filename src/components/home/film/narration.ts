// Spoken lines for every film: the 90-second film, the five story films, the five role films.
// Pure, relative `.ts` imports only: scripts/film/narrate.mjs loads this under plain node.
// Word budget is about 2.2 words a second; narrate.mjs fails any line that does not fit before the next one.
import { explainerTimeline } from "../../tour/explainer/timeline.ts";
import { TOUR_ROLES } from "../../tour/roles.ts";
import { STORIES } from "../story.ts";
import { FILM, FILM_FPS } from "./film-timeline.ts";

export interface NarrationLine {
  id: string;
  /** Frame where the line starts. */
  from: number;
  text: string;
}
export interface FilmNarration {
  id: string;
  fps: number;
  durationInFrames: number;
  lines: readonly NarrationLine[];
}

const LEAD = 6; // a beat after the cut, so the picture lands first

const fabricLines: readonly NarrationLine[] = [
  { id: "open", from: FILM.open.from + LEAD, text: "A school runs on loose threads." },
  {
    id: "problems",
    from: FILM.problems[0].from + LEAD,
    text: "The paper register. The receipt book. The marks spreadsheet. The enquiry notebook. The WhatsApp groups. The tuition class. And whatever the principal remembers.",
  },
  { id: "weave", from: FILM.weave.from + LEAD, text: "Fabric weaves them into one record. Everyone reads the same page." },
  { id: "story-title", from: FILM.storyTitle.from + 4, text: "Follow one absence." },
  { id: "step-1", from: FILM.story[0].from + LEAD, text: "The class teacher marks the register on a phone." },
  { id: "step-2", from: FILM.story[1].from + LEAD, text: "The parent sees it in the portal; alerts are simulated." },
  { id: "step-3", from: FILM.story[2].from + LEAD, text: "The office gets one list of today's absentees." },
  { id: "step-4", from: FILM.story[3].from + LEAD, text: "Repeated absence is flagged, and a person reviews it." },
  { id: "step-5", from: FILM.story[4].from + LEAD, text: "AI drafts a note. The teacher edits and sends." },
  { id: "outcome", from: FILM.outcome.from + LEAD, text: "One tap. Four people informed." },
  { id: "people", from: FILM.people.from + LEAD, text: "Each person sees their own school." },
  { id: "ai", from: FILM.ai.from + LEAD, text: "AI drafts. A person decides. It never writes marks, payments, access, or welfare decisions." },
  { id: "numbers", from: FILM.numbers.from + LEAD, text: "Modules, roles, AI skills, languages. Switch on only what you need." },
  { id: "end", from: FILM.end.from + LEAD, text: "The whole school, woven into one system. Try the demo. No sign-up." },
];

/** Per story key: title, one line per step, end line. Rewritten as speech, not copied from labels. */
const STORY_TEXT: Record<string, { title: string; steps: readonly string[]; end: string }> = {
  absent: {
    title: "Absent today. What happens next?",
    steps: [
      "The class teacher marks the register on a phone.",
      "The parent sees it in the portal; alerts are simulated.",
      "The office gets one list of today's absentees.",
      "Repeated absence is flagged, and a person reviews it.",
      "AI drafts a note. The teacher edits and sends.",
    ],
    end: "One tap in class. Four people informed.",
  },
  fees: {
    title: "Fees due: from invoice to ledger.",
    steps: [
      "One fee structure raises the invoice for every student.",
      "The parent sees it. Online payment is test mode only.",
      "Each payment gets a numbered receipt. Corrections add entries.",
      "AI drafts reminders. The accountant approves before sending.",
      "The principal sees collected, due, and a projection.",
    ],
    end: "One ledger. No second spreadsheet.",
  },
  results: {
    title: "From unit test to report card.",
    steps: [
      "The teacher builds a paper from the question bank.",
      "Marks go in once. Totals and grades are worked out.",
      "The exam controller verifies, then publishes.",
      "The parent reads the report card at home.",
      "If a mark changes, a new version is published.",
    ],
    end: "Marks typed once. Every version kept.",
  },
  enquiry: {
    title: "A family asks about a seat.",
    steps: [
      "The family fills the enquiry form on the school website.",
      "It lands as one card in the admissions pipeline.",
      "AI drafts a reply. The officer edits and sends it.",
      "The decision is recorded, with who and when.",
      "The applicant becomes a student record, not retyped.",
    ],
    end: "Every enquiry has an owner.",
  },
  stuck: {
    title: "Stuck on a chapter at nine.",
    steps: [
      "The student takes a practice quiz on the chapter.",
      "The assistant gives hints before answers, in many languages.",
      "Weak topics become a short revision list.",
      "The teacher sees which topics the section finds hard.",
      "The parent can read a short weekly summary.",
    ],
    end: "Help that does not need tuition fees.",
  },
};

const ROLE_TEXT: Record<string, { title: string; beats: readonly string[]; end: string }> = {
  principal: {
    title: "Principal: the whole school, one dashboard.",
    beats: [
      "Attendance, fees, admissions, and results, on one dashboard.",
      "A short daily briefing of approvals and attendance.",
      "Fee collection is projected from past terms.",
      "See enquiries, applications, and enrolments at each stage.",
      "Attendance and defaulter reports run on a schedule.",
      "Early warnings flag issues for a person to review.",
    ],
    end: "Try the Principal demo.",
  },
  admin: {
    title: "Administrator: one front desk.",
    beats: [
      "Student records with admission numbers and guardians.",
      "Raise invoices, and record cash, UPI, or bank payments.",
      "Move enquiries through stages, then offer or enrol.",
      "Edit the school website, then publish it.",
      "Email is live. SMS and WhatsApp are simulated here.",
      "The audit log shows who changed what.",
    ],
    end: "Try the Administrator demo.",
  },
  teacher: {
    title: "Teacher: attendance, homework, marks.",
    beats: [
      "Mark a whole section at once. Correct mistakes with a reason.",
      "Post homework and notes for each section.",
      "Create assignments, publish them, and grade submissions.",
      "Enter marks for each paper, checked before publishing.",
      "AI drafts a quiz. You review it before saving.",
    ],
    end: "Try the Teacher demo.",
  },
  student: {
    title: "Student: your school, in one place.",
    beats: [
      "See your own attendance for the year.",
      "See what is due, submitted, and graded.",
      "Open your published report card for each exam.",
      "One page for your school details. The layout is basic.",
      "Messages from your school appear in your notifications.",
    ],
    end: "Try the Student demo.",
  },
  parent: {
    title: "Parent: follow your child's school.",
    beats: [
      "See your child's fees and open a printable receipt.",
      "Absence notices come by SMS. SMS is simulated here.",
      "View your child's published report card. Print view only.",
      "Read homework and notes from your child's teachers.",
      "Book a parent-teacher meeting. No reminders are sent yet.",
    ],
    end: "Try the Parent demo.",
  },
};

function explainerLines(featureCount: number, text: { title: string; beats: readonly string[]; end: string }) {
  const t = explainerTimeline(featureCount);
  if (text.beats.length !== featureCount) throw new Error(`narration has ${text.beats.length} beats, the film has ${featureCount}`);
  return {
    durationInFrames: t.durationInFrames,
    lines: [
      { id: "title", from: t.title.from + LEAD, text: text.title },
      ...text.beats.map((b, i) => ({ id: `beat-${i + 1}`, from: t.beats[i].from + LEAD, text: b })),
      { id: "end", from: t.end.from + LEAD, text: text.end },
    ],
  };
}

export const NARRATION: readonly FilmNarration[] = [
  { id: "fabric", fps: FILM_FPS, durationInFrames: FILM.durationInFrames, lines: fabricLines },
  ...STORIES.map((s) => ({ id: `story-${s.key}`, fps: FILM_FPS, ...explainerLines(s.steps.length, { title: STORY_TEXT[s.key].title, beats: STORY_TEXT[s.key].steps, end: STORY_TEXT[s.key].end }) })),
  ...TOUR_ROLES.map((r) => ({ id: `role-${r.key}`, fps: FILM_FPS, ...explainerLines(r.features.length, ROLE_TEXT[r.key]) })),
];

export const narrationFor = (id: string) => NARRATION.find((f) => f.id === id);
export const audioPath = (filmId: string, lineId: string) => `audio/${filmId}/${lineId}.mp3`;
/** Seconds the line may run: until the next line starts, or the film ends. */
export function slotSeconds(film: FilmNarration, index: number): number {
  const next = film.lines[index + 1]?.from ?? film.durationInFrames;
  return (next - film.lines[index].from) / film.fps;
}
