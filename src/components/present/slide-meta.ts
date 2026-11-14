// The /present deck's running order: one entry per slide, with speaker notes. Content lives in
// src/components/home/story.ts; this file only orders it. No statistics, prices or customers.
import { AI_RULES, STORIES } from "@/components/home/story";

export type SlideId =
  | "title"
  | "threads"
  | "cost"
  | "idea"
  | "story-absent"
  | "story-fees"
  | "story-results"
  | "people"
  | "ai"
  | "ai-rules"
  | "modules"
  | "trust"
  | "plain"
  | "start"
  | "try";

export interface SlideMeta {
  id: SlideId;
  /** aria-label of the slide and its name in the overview. */
  title: string;
  notes: string;
  /** Fragments revealed one at a time before the deck moves on. */
  frags: number;
  /** STORIES key, for the use-case slides. */
  story?: string;
}

const stepsOf = (key: string) => STORIES.find((s) => s.key === key)?.steps.length ?? 0;

const story = (key: "absent" | "fees" | "results", title: string, notes: string): SlideMeta => ({
  id: `story-${key}`,
  title,
  notes,
  frags: stepsOf(key),
  story: key,
});

export const SLIDES: readonly SlideMeta[] = [
  {
    id: "title",
    title: "Fabric",
    notes:
      "Fabric is one system for the whole school: attendance, fees, exams, admissions, parents, learning and the daily running. It is built for budget-conscious private schools in India. If there is time, the 90-second film shows the whole idea before we go through it.",
    frags: 0,
  },
  {
    id: "threads",
    title: "The school today: seven loose threads",
    notes:
      "Most schools already run on seven separate tools: a register, a receipt book, a marks spreadsheet, an enquiry notebook, WhatsApp groups, tuition and the principal's memory. Each one works on its own. None of them talk to each other.",
    frags: 0,
  },
  {
    id: "cost",
    title: "What loose threads cost a school",
    notes:
      "The cost is not in any one tool; it is in the gaps between them. Patterns stay hidden, answers wait for one person, and work is copied by hand. Parents also hear about fees, homework and results by different routes.",
    frags: 0,
  },
  {
    id: "idea",
    title: "The idea: one record, every thread connected",
    notes:
      "Fabric weaves those threads into one record. A teacher marks attendance once, and the office, the parent and the principal read the same thing. Each person signs in to their own view of it.",
    frags: 0,
  },
  story(
    "absent",
    "Use case: absent today",
    "Follow one absence through the school. The teacher marks the register once, the parent sees it in the portal, the office has the list, and a pattern is flagged for a person to review. WhatsApp and SMS alerts are simulated until the school connects a provider.",
  ),
  story(
    "fees",
    "Use case: fees due",
    "One fee structure raises the invoice for the whole grade. Every payment gets a numbered receipt that is never edited; a correction is a new entry. Online payment runs in Razorpay test mode today, while cash, cheque and transfer entries work.",
  ),
  story(
    "results",
    "Use case: report cards",
    "Marks are entered once and totals are worked out for you. Only a person verifies and publishes, and AI never writes marks. If a mark changes after a recheck, a new version is published and the old one is kept.",
  ),
  {
    id: "people",
    title: "Five people, one system",
    notes:
      "The principal, the office, teachers, students and parents each see their own view of the same school. Nobody gets a screen full of things that are not theirs. Each of these has a demo account you can try at the end.",
    frags: 0,
  },
  {
    id: "ai",
    title: "AI drafts. A person decides.",
    notes:
      "The AI in Fabric drafts and suggests; a person saves. Marks, payments, access and welfare decisions are closed to it in code. Students can study with it in their own language.",
    frags: 0,
  },
  {
    id: "ai-rules",
    title: "Four rules the AI follows",
    notes:
      "These four rules are built into the product, not written in a policy document. The AI sees only what the person asking may see. The school decides which roles get which skills, and can keep every request off cloud models.",
    frags: AI_RULES.length,
  },
  {
    id: "modules",
    title: "Everything in the box",
    notes:
      "This is the full module list, grouped by area. The core is always on and every other module is a switch, so a small school can start small. Pricing is quoted per school.",
    frags: 0,
  },
  {
    id: "trust",
    title: "Built to be trusted",
    notes:
      "Each school's data is walled off by the database itself, not only by the app. Every action is checked twice: which rows you may touch and what your role may do. Money and marks are written in ink: corrections are new entries beside the old ones.",
    frags: 0,
  },
  {
    id: "plain",
    title: "Stated plainly",
    notes:
      "We would rather you hear the limits from us. Online payment is in test mode, messaging channels are simulated until connected, and insights only flag and project. Native mobile apps are planned; today it runs in a phone browser.",
    frags: 0,
  },
  {
    id: "start",
    title: "How a school starts",
    notes:
      "Starting is three steps: bring your lists, switch on what you need, and invite people by role. Students and staff come in from a spreadsheet with CSV templates. Pricing is quoted per school, so we will talk through yours.",
    frags: 0,
  },
  {
    id: "try",
    title: "Try it now",
    notes:
      "Pick any role and you are inside the demo school in one click, with no sign-up. The 3D school tour walks through a school day. To see it with your own school in mind, book a demo on the contact page.",
    frags: 0,
  },
];

export const FRAGS: readonly number[] = SLIDES.map((s) => s.frags);

/** Props every slide view receives: how many fragments are revealed, and a way to open a film. */
export interface SlideProps {
  step: number;
  /** "film" for the 90-second product film, or a STORIES key. */
  onFilm: (key: string) => void;
}
