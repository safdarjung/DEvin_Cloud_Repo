// Script for the "ask it" demo on the landing page: four people, two questions each, and the drawn answer
// the assistant gives. Every figure is sample data for a made-up school; the section says so on screen.
// The answer kinds mirror what the product's assistant draws: charts, a mind map, hints and a week strip.
import type { PersonKey } from "./story.ts";

export interface Bar {
  label: string;
  /** 0..100, the bar's length. */
  value: number;
  /** What is printed at the end of the bar. */
  text: string;
}

export type Answer =
  | { kind: "bars"; bars: readonly Bar[] }
  | { kind: "donut"; percent: number; centre: string; facts: readonly { label: string; value: string }[] }
  | { kind: "mindmap"; centre: string; branches: readonly { label: string; leaves: readonly string[] }[] }
  | { kind: "hints"; languages: readonly { key: string; label: string; hints: readonly string[]; answer: string }[] }
  | { kind: "week"; days: readonly { day: string; text: string; tone: "good" | "bad" | "plain" }[]; facts: readonly string[] };

export interface DemoQuestion {
  ask: string;
  /** One line under the answer: where it was read from and for whom. */
  source: string;
  /** "reads" answers from records; "drafts" prepares something a person must save. */
  mode: "reads" | "drafts";
  title: string;
  answer: Answer;
}

export interface DemoRole {
  who: PersonKey;
  questions: readonly [DemoQuestion, DemoQuestion];
}

export const ASK_DEMO: readonly DemoRole[] = [
  {
    who: "principal",
    questions: [
      {
        ask: "Which classes missed the most school this week?",
        source: "Read from the attendance register. Scope: the whole school.",
        mode: "reads",
        title: "Absence this week, by class",
        answer: {
          kind: "bars",
          bars: [
            { label: "Grade 8-B", value: 84, text: "21 absences" },
            { label: "Grade 6-A", value: 64, text: "16 absences" },
            { label: "Grade 9-C", value: 48, text: "12 absences" },
            { label: "Grade 7-A", value: 28, text: "7 absences" },
            { label: "Grade 5-B", value: 16, text: "4 absences" },
          ],
        },
      },
      {
        ask: "Where does this term's fee collection stand?",
        source: "Read from the fee ledger. Scope: the whole school.",
        mode: "reads",
        title: "Term 2 fees",
        answer: {
          kind: "donut",
          percent: 68,
          centre: "collected",
          facts: [
            { label: "Collected", value: "₹18.4 lakh" },
            { label: "Still due", value: "₹8.6 lakh" },
            { label: "Families with dues", value: "112" },
          ],
        },
      },
    ],
  },
  {
    who: "teacher",
    questions: [
      {
        ask: "Plan a lesson on photosynthesis for Grade 7.",
        source: "Opens as a draft in the lesson planner. Nothing is stored until the teacher saves it.",
        mode: "drafts",
        title: "Photosynthesis, one period",
        answer: {
          kind: "mindmap",
          centre: "Photosynthesis",
          branches: [
            { label: "Starter", leaves: ["Why are leaves green?"] },
            { label: "Explain", leaves: ["Light, water, CO₂", "Chlorophyll"] },
            { label: "Activity", leaves: ["Leaf in the dark, 2 days"] },
            { label: "Check", leaves: ["5 quick questions"] },
            { label: "Homework", leaves: ["Draw the cycle"] },
          ],
        },
      },
      {
        ask: "Which topics is 8-B finding hard?",
        source: "Read from practice and test answers. Scope: this teacher's own sections.",
        mode: "reads",
        title: "Mastery by topic, Grade 8-B Maths",
        answer: {
          kind: "bars",
          bars: [
            { label: "Linear equations", value: 82, text: "Secure" },
            { label: "Exponents", value: 71, text: "Secure" },
            { label: "Rational numbers", value: 54, text: "Shaky" },
            { label: "Word problems", value: 38, text: "Reteach" },
          ],
        },
      },
    ],
  },
  {
    who: "student",
    questions: [
      {
        ask: "I am stuck on adding fractions.",
        source: "The study assistant gives a hint first. The answer comes only when asked for.",
        mode: "reads",
        title: "½ + ¼ = ?",
        answer: {
          kind: "hints",
          languages: [
            {
              key: "en",
              label: "English",
              hints: ["The bottom numbers are different. Can you make them the same?", "Write ½ as 2⁄4. Now both fractions are quarters."],
              answer: "2⁄4 + 1⁄4 = 3⁄4",
            },
            {
              key: "hi",
              label: "हिन्दी",
              hints: ["नीचे की संख्याएँ अलग हैं। क्या तुम उन्हें बराबर कर सकते हो?", "½ को 2⁄4 लिखो। अब दोनों भिन्न चौथाई में हैं।"],
              answer: "2⁄4 + 1⁄4 = 3⁄4",
            },
          ],
        },
      },
      {
        ask: "Make me a revision plan for this week.",
        source: "Built from the topics this student got wrong in practice.",
        mode: "drafts",
        title: "This week, 20 minutes a day",
        answer: {
          kind: "week",
          days: [
            { day: "Mon", text: "Fractions", tone: "plain" },
            { day: "Tue", text: "Fractions quiz", tone: "plain" },
            { day: "Wed", text: "Plant cell", tone: "plain" },
            { day: "Thu", text: "Tenses", tone: "plain" },
            { day: "Fri", text: "Map work", tone: "plain" },
            { day: "Sat", text: "Mixed quiz", tone: "good" },
          ],
          facts: ["Weakest first", "One topic a day"],
        },
      },
    ],
  },
  {
    who: "parent",
    questions: [
      {
        ask: "How was my child's week?",
        source: "Read from this parent's own child only: attendance, homework and fees.",
        mode: "reads",
        title: "Aarav, Grade 6-A, this week",
        answer: {
          kind: "week",
          days: [
            { day: "Mon", text: "Present", tone: "good" },
            { day: "Tue", text: "Present", tone: "good" },
            { day: "Wed", text: "Absent", tone: "bad" },
            { day: "Thu", text: "Present", tone: "good" },
            { day: "Fri", text: "Present", tone: "good" },
            { day: "Sat", text: "Present", tone: "good" },
          ],
          facts: ["Homework: 4 of 5 handed in", "Term 2 fee due 30 Nov"],
        },
      },
      {
        ask: "Explain the report card in plain words.",
        source: "Read from the published report card. Marks are entered by teachers, never by AI.",
        mode: "reads",
        title: "Unit Test 2, in short",
        answer: {
          kind: "bars",
          bars: [
            { label: "English", value: 88, text: "Strong" },
            { label: "Science", value: 79, text: "Steady" },
            { label: "Social Science", value: 72, text: "Steady" },
            { label: "Maths", value: 58, text: "Needs practice" },
          ],
        },
      },
    ],
  },
];
