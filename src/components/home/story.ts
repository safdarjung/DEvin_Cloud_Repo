// The one narrative behind the landing page (/), the deck (/product/deck) and the product films.
// Plain data, type-only relative imports: the film render scripts load this file under plain node.
//
// Honesty (project rule 7): a step whose channel is simulated, limited or test-mode carries `label`,
// and every surface that shows the step must show the label. No statistics are quoted anywhere here:
// we have no measured numbers, so the copy describes what happens, not how much.
import type { SceneKey } from "../tour/explainer/scene-map.ts";
import type { TourRoleKey } from "../tour/roles.ts";

export type HonestyLabel = "simulated" | "limited" | "test mode";
export const HONESTY_TEXT: Readonly<Record<HonestyLabel, string>> = {
  simulated: "Simulated until configured",
  limited: "Limited",
  "test mode": "Test mode only",
};

/* ---------- threads: the domains a school runs on; one yarn colour each ---------- */

export type ThreadKey = "attendance" | "fees" | "exams" | "admissions" | "parents" | "learning" | "office";

export interface Thread {
  key: ThreadKey;
  label: string;
  color: string;
}

export const THREADS: readonly Thread[] = [
  { key: "attendance", label: "Attendance", color: "#00C853" },
  { key: "fees", label: "Fees", color: "#FF6B35" },
  { key: "exams", label: "Exams", color: "#7B61FF" },
  { key: "admissions", label: "Admissions", color: "#00B8D9" },
  { key: "parents", label: "Parents", color: "#FF2D95" },
  { key: "learning", label: "Learning", color: "#2979FF" },
  { key: "office", label: "Daily running", color: "#FFB800" },
];

export const THREAD: Readonly<Record<ThreadKey, Thread>> = Object.fromEntries(THREADS.map((t) => [t.key, t])) as Record<ThreadKey, Thread>;

/* ---------- people ---------- */

export type PersonKey = "principal" | "admin" | "accountant" | "admissions" | "exams" | "teacher" | "student" | "parent";

export interface Person {
  key: PersonKey;
  label: string;
  accent: string;
  /** The tour role whose mascot, explainer and demo account stand in for this person. */
  tour: TourRoleKey;
}

export const PEOPLE: Readonly<Record<PersonKey, Person>> = {
  principal: { key: "principal", label: "Principal", accent: "#FF6B35", tour: "principal" },
  admin: { key: "admin", label: "Administrator", accent: "#7B61FF", tour: "admin" },
  accountant: { key: "accountant", label: "Accountant", accent: "#B45309", tour: "admin" },
  admissions: { key: "admissions", label: "Admissions officer", accent: "#00B8D9", tour: "admin" },
  exams: { key: "exams", label: "Exam controller", accent: "#7B61FF", tour: "admin" },
  teacher: { key: "teacher", label: "Teacher", accent: "#00C853", tour: "teacher" },
  student: { key: "student", label: "Student", accent: "#2979FF", tour: "student" },
  parent: { key: "parent", label: "Parent", accent: "#FF2D95", tour: "parent" },
};

/* ---------- the problems: seven loose threads ---------- */

export interface Problem {
  thread: ThreadKey;
  /** The physical thing the school uses today; also the tag on the yarn in the 3D hero. */
  artefact: string;
  pain: string;
  detail: string;
  fix: string;
  label?: HonestyLabel;
  labelNote?: string;
}

export const PROBLEMS: readonly Problem[] = [
  {
    thread: "attendance",
    artefact: "The paper register",
    pain: "Attendance lives on paper.",
    detail: "A child's absences become a pattern only when someone finds time to add up the pages.",
    fix: "Teachers mark the register on a phone. The office, the parent and the principal read the same record.",
  },
  {
    thread: "fees",
    artefact: "The receipt book",
    pain: "Fees live in a receipt book and a spreadsheet.",
    detail: "Who has paid this term? The answer takes a day and the one person who knows.",
    fix: "Invoices, payments and numbered receipts sit in one ledger, so the list of dues is always current.",
    label: "test mode",
    labelNote: "Online payment runs in Razorpay test mode. Cash, cheque and transfer entries work today.",
  },
  {
    thread: "exams",
    artefact: "The marks spreadsheet",
    pain: "Result week is typing, totalling and checking by hand.",
    detail: "Marks pass through three files before a report card is printed, and every copy can go wrong.",
    fix: "Marks are entered once, verified by the exam controller and published as report cards.",
  },
  {
    thread: "admissions",
    artefact: "The enquiry notebook",
    pain: "Enquiries arrive by phone, by visit and on paper.",
    detail: "Some families never get a call back, and nobody can say how many.",
    fix: "Every enquiry lands in one pipeline, from the school website form to the enrolled student.",
  },
  {
    thread: "parents",
    artefact: "The WhatsApp groups",
    pain: "Parents follow five groups and still miss the notice that matters.",
    detail: "Fees, homework, results and leave each travel by a different route.",
    fix: "One parent portal per family: fees, attendance, results, diary, leave and meetings for each child.",
    label: "simulated",
    labelNote: "WhatsApp, SMS and email delivery are simulated until the school connects a provider. In-app notices work today.",
  },
  {
    thread: "learning",
    artefact: "The tuition class",
    pain: "A student stuck on a chapter at night has nobody to ask.",
    detail: "Help after school depends on what a family can pay for.",
    fix: "A study assistant gives hints before answers, in the student's own language, and shows the teacher where the class is stuck.",
  },
  {
    thread: "office",
    artefact: "The principal's memory",
    pain: "The school runs on what the principal remembers.",
    detail: "Knowing how today went means walking the corridor and making phone calls.",
    fix: "One daily view of attendance, collections, admissions and approvals, with flags on what needs a decision.",
  },
];

/* ---------- use cases: follow one thread through the school ---------- */

export interface StoryStep {
  who: PersonKey;
  /** Short heading, 28 characters or fewer (it is set large in the film). */
  title: string;
  /** One sentence, 100 characters or fewer. */
  blurb: string;
  /** lucide-react export name. */
  icon: string;
  /** Which mini product screen the film shows for this step. */
  scene: SceneKey;
  label?: HonestyLabel;
}

export interface Story {
  key: string;
  thread: ThreadKey;
  /** Two or three words; the tab label and the film title. */
  title: string;
  question: string;
  steps: readonly StoryStep[];
  outcome: string;
}

export const STORIES: readonly Story[] = [
  {
    key: "absent",
    thread: "attendance",
    title: "Absent today",
    question: "What happens when a child misses school?",
    steps: [
      { who: "teacher", title: "Register in a minute", blurb: "The class teacher marks the register on a phone before first period.", icon: "CalendarCheck", scene: "register" },
      { who: "parent", title: "The parent is told", blurb: "The absence shows in the parent portal. WhatsApp and SMS alerts are simulated until set up.", icon: "Bell", scene: "alert", label: "simulated" },
      { who: "admin", title: "The office has the list", blurb: "Today's absentees are on one screen. Nobody phones each class.", icon: "Users", scene: "roster" },
      { who: "principal", title: "A pattern is flagged", blurb: "Repeated absence is flagged for a person to review, with the days listed.", icon: "Sparkles", scene: "insights", label: "limited" },
      { who: "teacher", title: "AI drafts, teacher sends", blurb: "A note to the parent is drafted. The teacher edits it and decides to send.", icon: "Megaphone", scene: "messages" },
    ],
    outcome: "One tap in class. Four people informed. No phone calls.",
  },
  {
    key: "fees",
    thread: "fees",
    title: "Fees due",
    question: "How does a term fee get collected?",
    steps: [
      { who: "accountant", title: "Invoices for the grade", blurb: "One fee structure raises the term invoice for every student in the grade.", icon: "Banknote", scene: "receipt" },
      { who: "parent", title: "The parent sees it", blurb: "The invoice is in the portal. Online payment runs in Razorpay test mode only.", icon: "BookOpen", scene: "portal", label: "test mode" },
      { who: "accountant", title: "A receipt that stays", blurb: "Each payment gets a numbered receipt. A correction adds an entry; nothing is edited.", icon: "Shield", scene: "audit" },
      { who: "accountant", title: "Reminders, drafted", blurb: "AI drafts a reminder per family with dues. The accountant approves before any are sent.", icon: "Megaphone", scene: "messages" },
      { who: "principal", title: "Collections, projected", blurb: "The principal sees collected, due and a projection from past terms.", icon: "TrendingUp", scene: "forecast", label: "limited" },
    ],
    outcome: "No second spreadsheet. The dues list is the ledger.",
  },
  {
    key: "results",
    thread: "exams",
    title: "Report cards",
    question: "How does a unit test become a report card?",
    steps: [
      { who: "teacher", title: "Paper from the bank", blurb: "The teacher builds a paper from the question bank. AI can suggest; the teacher picks.", icon: "FileText", scene: "assignments" },
      { who: "teacher", title: "Marks entered once", blurb: "Marks go in per student and subject. Totals and grades are worked out for you.", icon: "GraduationCap", scene: "marks" },
      { who: "exams", title: "Verified, then published", blurb: "The exam controller checks the marks and publishes. Only people can do either.", icon: "Shield", scene: "audit" },
      { who: "parent", title: "Explained at home", blurb: "The parent reads the report card, and can ask for it in plain words.", icon: "BookOpen", scene: "portal" },
      { who: "student", title: "A recheck adds a version", blurb: "If a mark changes, a new version is published. The old one is kept.", icon: "FileText", scene: "reports" },
    ],
    outcome: "Marks typed once. Every version kept.",
  },
  {
    key: "enquiry",
    thread: "admissions",
    title: "New enquiry",
    question: "What happens when a family asks about a seat?",
    steps: [
      { who: "parent", title: "A form on the website", blurb: "The family fills the enquiry form on the school's own website.", icon: "Globe", scene: "website" },
      { who: "admissions", title: "One pipeline", blurb: "It lands as a card: enquiry, application, decision, enrolled.", icon: "ClipboardList", scene: "kanban" },
      { who: "admissions", title: "A reply, drafted", blurb: "AI drafts a reply from the school's details. The officer edits and sends it.", icon: "Megaphone", scene: "messages" },
      { who: "principal", title: "A decision on record", blurb: "The decision is recorded with who made it and when.", icon: "Shield", scene: "audit" },
      { who: "admin", title: "Enrolled, not retyped", blurb: "The applicant becomes a student record with guardians, class and section.", icon: "Users", scene: "roster" },
    ],
    outcome: "Every enquiry has an owner and a next step.",
  },
  {
    key: "stuck",
    thread: "learning",
    title: "Stuck at 9 pm",
    question: "What does a student do when the chapter does not make sense?",
    steps: [
      { who: "student", title: "Practice on the chapter", blurb: "The student takes a practice quiz on the chapter they are studying.", icon: "Bot", scene: "quiz" },
      { who: "student", title: "Hints before answers", blurb: "The study assistant gives a hint first, in English, Hindi or ten other languages.", icon: "Megaphone", scene: "messages" },
      { who: "student", title: "A plan for weak topics", blurb: "Weak topics become a short revision list for the week.", icon: "CalendarCheck", scene: "calendar" },
      { who: "teacher", title: "The teacher sees gaps", blurb: "The teacher sees which topics the section finds hard before the exam.", icon: "LayoutDashboard", scene: "dashboard" },
      { who: "parent", title: "A weekly summary", blurb: "The parent can read a short summary of the week: attendance, homework, fees.", icon: "Sun", scene: "briefing" },
    ],
    outcome: "Help that does not depend on a tuition fee.",
  },
];

/* ---------- AI: what it may and may not do ---------- */

export const AI_PROMISE = "AI drafts. A person decides.";

export const AI_RULES: readonly { title: string; body: string }[] = [
  { title: "It drafts, you save", body: "Lesson plans, parent messages, fee reminders and question papers arrive as drafts. Nothing is stored until a person presses Save." },
  { title: "It never writes these", body: "Marks, payments, access rights and leave or welfare decisions are closed to AI in code, whatever it is asked." },
  { title: "It sees what you see", body: "Every answer is fetched with the permissions of the person asking. A parent's assistant can read only that parent's children." },
  { title: "Your school sets the limits", body: "Chat and each skill switch on or off per role, with a daily quota. A local-only policy keeps every request off cloud models." },
];

export const AI_NEVER: readonly string[] = ["Marks", "Payments", "Access", "Welfare decisions"];

/* ---------- trust ---------- */

export const TRUST: readonly { key: string; title: string; body: string }[] = [
  { key: "walls", title: "Walls between schools", body: "Every row carries its school. The database itself refuses a query that crosses the wall, whatever the app code does." },
  { key: "locks", title: "Two locks on every action", body: "The database checks which rows you may touch; the action checks what your role may do. Hiding a button is never the lock." },
  { key: "ink", title: "History written in ink", body: "Payments, receipts, marks, results and the audit log cannot be edited or deleted. A correction is a new entry beside the old one." },
  { key: "labels", title: "Labels that tell the truth", body: "If a channel is simulated or a feature is limited, the screen says so in words, in the product and on this page." },
];

/* ---------- how a school starts ---------- */

export const START_STEPS: readonly { title: string; body: string }[] = [
  { title: "Bring your lists", body: "Import students and staff from a spreadsheet using the CSV templates. AI can suggest which column is which; you confirm." },
  { title: "Switch on what you need", body: "The core is always on. Every other module is a switch, so a small school starts small." },
  { title: "Invite people by role", body: "Each person signs in to their own view: principal, office, teacher, student or parent." },
];

/* ---------- stated plainly ---------- */

export const PLAIN_FACTS: readonly { label: HonestyLabel | "planned"; text: string }[] = [
  { label: "test mode", text: "Online fee payment runs in Razorpay test mode only." },
  { label: "simulated", text: "WhatsApp, SMS and email delivery are simulated until a provider is connected." },
  { label: "limited", text: "Insights, forecasts and the daily briefing are limited: they flag and project, and a person reviews." },
  { label: "planned", text: "Native mobile apps are planned. Today the web app runs in a phone browser." },
];

export const TAGLINE = "The whole school, woven into one system.";
