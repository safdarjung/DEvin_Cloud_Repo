// FabricOS landing page — single source of copy and shared contracts.
// Every marketing component, the 3D scene and the JSON-LD read from here so
// page text, structured data and llms.txt can never drift apart.
//
// Honesty rule (CLAUDE.md rule 7): FabricOS is built and running for schools
// and colleges today. Other sectors are configuration conversations, never
// presented as prebuilt products. Illustrative demos are labelled as such.

export const BRAND = "FabricOS";

export const TAGLINE = "Your institution. Your workflows. Your AI.";

/** Answer-first product definition. Used near the top of the page, in metadata and in JSON-LD. */
export const DEFINITION =
  "FabricOS is a configurable, AI-powered operating system for institutions. It connects people, roles, departments, workflows, information and AI agents in one permission-checked workspace, so work moves forward while people stay in control. It is running today for schools and colleges.";

export const DESCRIPTION =
  "FabricOS connects your people, processes, information and AI agents in one configurable operating system built around the way your organisation works.";

/** Section anchors. Header nav, footer and in-page links use these ids. */
export const SECTION = {
  platform: "platform",
  showcase: "see-fabricos",
  agents: "ai-agents",
  automation: "automation",
  insights: "insights",
  useCases: "use-cases",
  trust: "human-control",
  howItWorks: "how-it-works",
  tour: "product-tour",
  faq: "faq",
} as const;

/** The long product page (the home until 2026-11-14, when the loom story became the home). Section anchors live there. */
export const OVERVIEW = "/product/overview";

export const NAV: readonly { href: string; label: string }[] = [
  { href: OVERVIEW, label: "Overview" },
  { href: `${OVERVIEW}#${SECTION.agents}`, label: "AI Agents" },
  { href: `${OVERVIEW}#${SECTION.automation}`, label: "Automation" },
  { href: `${OVERVIEW}#${SECTION.insights}`, label: "Insights" },
  { href: `${OVERVIEW}#${SECTION.useCases}`, label: "Use Cases" },
  { href: `${OVERVIEW}#${SECTION.howItWorks}`, label: "How It Works" },
  { href: "/tour", label: "Product Tour" },
];

/** Real routes only. */
export const CTA = {
  primary: { href: "/contact", label: "Book a demo" },
  secondary: { href: "/demo", label: "Try the live demo" },
  tour: { href: "/tour", label: "Take the product tour" },
  vision: { href: "/", label: "Explore Fabric Vision" },
  signIn: { href: "/login?switch=1", label: "Sign in" },
} as const;

// ---------------------------------------------------------------------------
// 3D hero contract
// ---------------------------------------------------------------------------

export type NodeKind = "core" | "people" | "agent" | "information" | "workflow" | "automation" | "insight";

export interface FabricNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** One or two sentences shown when the node is selected. Must stay factual. */
  blurb: string;
}

export const NODES: readonly FabricNode[] = [
  { id: "core", kind: "core", label: "FabricOS core", blurb: "One permission-checked workspace. Every record carries its institution, and the database enforces that boundary on its own." },
  { id: "people", kind: "people", label: "People and roles", blurb: "Leaders, administrators, teachers, students and parents each get a workspace scoped to what their role allows." },
  { id: "departments", kind: "people", label: "Departments and teams", blurb: "Offices, classes and teams share one source of records instead of separate spreadsheets." },
  { id: "agents", kind: "agent", label: "AI agents", blurb: "Agents read within the asker's permissions, prepare drafts and propose actions. A person approves anything that changes a record." },
  { id: "information", kind: "information", label: "Information", blurb: "Admissions, attendance, fees, exams, assignments and notices live on the same records." },
  { id: "workflows", kind: "workflow", label: "Workflows", blurb: "Requests move through defined steps: draft, review, approve, publish. Corrections add a new version instead of overwriting history." },
  { id: "automation", kind: "automation", label: "Automation", blurb: "Reminders, follow-ups and routine drafts are prepared for you, then wait for a person where approval is required." },
  { id: "insights", kind: "insight", label: "Insights", blurb: "Attention signals and forecasts across modules, so leaders see what needs a decision today." },
];

/** Scroll story: one step per stage of the ecosystem reveal. `reveal` lists node kinds visible from this step on. */
export const STORY: readonly { id: string; title: string; body: string; reveal: readonly NodeKind[] }[] = [
  { id: "core", title: "It starts with one core.", body: "A single operating layer for your institution, instead of a different tool for every office.", reveal: ["core"] },
  { id: "people", title: "Your people and departments join it.", body: "Every role works from the same records, each seeing only what they are allowed to see.", reveal: ["core", "people"] },
  { id: "workflows", title: "Work flows between them.", body: "Requests, reviews and approvals connect departments in defined steps.", reveal: ["core", "people", "workflow", "automation"] },
  { id: "agents", title: "AI agents come online.", body: "Agents prepare drafts and propose next steps inside each person's permissions.", reveal: ["core", "people", "workflow", "automation", "agent"] },
  { id: "insights", title: "Information turns into insight.", body: "Signals from attendance, fees and results surface what needs attention.", reveal: ["core", "people", "workflow", "automation", "agent", "information", "insight"] },
  { id: "ecosystem", title: "One connected institution.", body: "People, processes, information and AI working together, with people in control.", reveal: ["core", "people", "workflow", "automation", "agent", "information", "insight"] },
];

// ---------------------------------------------------------------------------
// Product video contract (assets produced from real screen recordings)
// ---------------------------------------------------------------------------

export type VideoId = "overview" | "agents" | "automation" | "insights" | "roles";

// ---------------------------------------------------------------------------
// Section copy
// ---------------------------------------------------------------------------

export const PROBLEM = {
  title: "Most institutions run on disconnected systems.",
  lead: "Admissions in one place, fees in another, messages in a third. People spend their day copying information between tools and chasing approvals.",
  fragments: ["Spreadsheets", "Paper registers", "Chat groups", "Separate fee software", "Email threads", "Manual reports"],
  resolution: "FabricOS puts them on one set of records, so the work connects instead of the people.",
};

export const AGENT_DEMO = {
  label: "Illustrative example. Not live data.",
  request: "Which Class 8 students have missed three or more days this month, and draft a note to their parents.",
  steps: [
    { id: "request", title: "Request", body: "A class teacher asks in plain language." },
    { id: "understand", title: "Agent understanding", body: "The agent identifies the class, the date range and the attendance rule." },
    { id: "information", title: "Information", body: "It reads only the attendance this teacher is allowed to see." },
    { id: "proposal", title: "Proposed action", body: "It lists the students and drafts a message for each family." },
    { id: "review", title: "Human review", body: "The teacher edits, approves or discards each draft." },
    { id: "result", title: "Result", body: "Approved notes are queued to send. Nothing is sent without the teacher." },
  ],
} as const;

export const CONFIGURE_LAYERS: readonly { title: string; body: string }[] = [
  { title: "Structure", body: "Campuses, departments, classes and teams, modelled the way your institution is organised." },
  { title: "Roles and permissions", body: "Who can see, draft, approve and publish, enforced in the database and in every action." },
  { title: "Workflows", body: "The steps a request moves through, including where a person must approve." },
  { title: "Information", body: "The modules you switch on: admissions, attendance, fees, exams, assignments, website and notices." },
  { title: "AI policy", body: "Which AI capabilities each role may use, and whether models run in the cloud or locally." },
];

export const WORKFLOW: readonly { id: string; title: string; body: string }[] = [
  { id: "request", title: "Request", body: "Someone starts a task or a schedule triggers one." },
  { id: "agent", title: "AI agent", body: "Prepares the draft or recommendation." },
  { id: "info", title: "Relevant information", body: "Pulled from records the requester may access." },
  { id: "workflow", title: "Workflow", body: "Routed through your defined steps." },
  { id: "approval", title: "Human approval", body: "A person approves, edits or rejects." },
  { id: "outcome", title: "Outcome", body: "The record updates and the action is logged." },
];

export const INSIGHTS = {
  label: "Illustrative data. Not a customer's figures.",
  signals: [
    { title: "Attendance dips", body: "Classes or students trending below their usual attendance." },
    { title: "Pending approvals", body: "Drafts, results and requests waiting on a decision." },
    { title: "Fee follow-ups", body: "Outstanding invoices that need a reminder." },
    { title: "Exceptions", body: "Anything that broke a rule you set, flagged for review." },
  ],
};

export const CONNECTED: readonly { title: string; body: string }[] = [
  { title: "People", body: "One login, one workspace per role." },
  { title: "Departments", body: "Offices and classes working from shared records." },
  { title: "Processes", body: "Defined steps with a visible trail." },
  { title: "Information", body: "Entered once, used everywhere it is allowed." },
  { title: "AI", body: "Assistance inside the same permissions as the person asking." },
];

export interface UseCase {
  id: string;
  title: string;
  status: "available" | "configurable";
  summary: string;
  examples: readonly string[];
}

export const USE_CASES: readonly UseCase[] = [
  { id: "education", title: "Education and Training", status: "available", summary: "Running today for schools and colleges.", examples: ["Admissions to enrolment", "Attendance and parent notices", "Fees, receipts and results"] },
  { id: "institutes", title: "Professional Institutes", status: "configurable", summary: "Courses, cohorts and assessments map onto the same core.", examples: ["Enrolment and batches", "Assessments and certificates", "Learner communication"] },
  { id: "associations", title: "Associations", status: "configurable", summary: "Members, committees and approvals as roles and workflows.", examples: ["Membership records", "Committee approvals", "Notices to members"] },
  { id: "services", title: "Service Organisations", status: "configurable", summary: "Requests, cases and follow-ups routed through defined steps.", examples: ["Request intake", "Case review and approval", "Follow-up reminders"] },
  { id: "multi-team", title: "Multi-Team Businesses", status: "configurable", summary: "Several teams sharing records, approvals and AI assistance.", examples: ["Cross-team approvals", "Shared records", "Operational signals"] },
  { id: "other", title: "Other Institutions", status: "configurable", summary: "If your work has roles, records and approvals, we can talk about configuring it.", examples: ["Discovery of your workflows", "A scoped configuration plan", "A pilot with your team"] },
];

export const USE_CASE_NOTE = "Education is built and running today. For other sectors we configure the same core with you; we do not claim a finished product for every industry.";

export const TRUST = {
  title: "AI proposes. People decide.",
  lead: "AI output in FabricOS is a suggestion. A person saves or approves it. AI never writes marks, payments, access or welfare decisions.",
  points: [
    { title: "Permission-checked", body: "Agents can only read what the person asking is allowed to read." },
    { title: "Approval before change", body: "Anything that changes a record waits for a person to approve it." },
    { title: "Audit trail", body: "Sensitive actions are recorded as append-only events you can review." },
    { title: "Your AI policy", body: "Each institution chooses cloud models or local-only processing." },
  ],
  proposal: {
    label: "Illustrative example",
    title: "Agent proposal: fee reminder for 12 families",
    detail: "Invoices overdue by 14+ days. Draft message attached for review.",
  },
};

export const HOW_IT_WORKS: readonly { title: string; body: string }[] = [
  { title: "Understand the organisation", body: "We map your structure, roles and the work that matters most." },
  { title: "Configure structure and workflows", body: "Departments, permissions and approval steps are set up to match." },
  { title: "Connect information and AI assistance", body: "Records are brought in and AI capabilities are enabled per role." },
  { title: "Introduce insights and automation", body: "Reminders, drafts and attention signals start helping day to day." },
  { title: "Continuously improve", body: "Workflows are refined as you see where time goes." },
];

/** Visible FAQ copy. FAQPage JSON-LD must be generated from this exact array. */
export const FAQ: readonly { q: string; a: string }[] = [
  { q: "What is FabricOS?", a: DEFINITION },
  { q: "What problems does FabricOS solve?", a: "It replaces disconnected tools, such as spreadsheets, separate fee software and chat groups, with one set of records. Information is entered once, approvals follow defined steps, and AI agents prepare routine work so people spend less time coordinating." },
  { q: "Which organisations can use FabricOS?", a: "FabricOS is built and running today for schools and colleges. Its core of roles, workflows, approvals and AI agents is designed to be configured for other institutions, such as professional institutes, associations and service organisations. For those we scope a configuration with you rather than offering a prebuilt product." },
  { q: "What are FabricOS AI agents?", a: "AI agents answer questions, prepare drafts and propose actions inside the permissions of the person asking. They can read only what that person may read, and a person approves anything that changes a record." },
  { q: "What is the FabricOS Orb?", a: "The Orb is each person's AI assistant inside FabricOS: one sphere that holds every skill their role may use. You ask in plain language, it reads only what you are allowed to see, draws the answer as a chart, a mind map or step-by-step hints, and returns anything that would change a record as a proposal for you to approve." },
  { q: "How does workflow automation work in FabricOS?", a: "A request or a schedule starts a workflow. An AI agent prepares the draft or recommendation from relevant records, the workflow routes it through your defined steps, a person approves it, and the outcome is recorded in the audit log." },
  { q: "How can an organisation configure FabricOS?", a: "You configure your structure, roles and permissions, the modules you use, the approval steps in each workflow, and an AI policy that sets which AI capabilities each role may use and whether models run in the cloud or locally." },
  { q: "How does FabricOS provide operational insights?", a: "It surfaces attention signals and forecasts from the same records your teams work in, such as attendance dips, pending approvals and overdue fees, so leaders can see what needs a decision." },
  { q: "How does human control work?", a: "AI output is a suggestion. A person saves or approves it. AI never writes marks, payments, access or welfare decisions, and sensitive actions are recorded in an append-only audit log." },
  { q: "How is FabricOS different from traditional ERP software?", a: "Traditional ERP software asks an institution to adapt to fixed modules. FabricOS is configured around your structure and workflows, and adds AI agents that prepare work within each person's permissions, with people approving every change." },
  { q: "How does onboarding work?", a: "We start with a conversation about how your institution works, configure FabricOS around it, bring in your records and enable AI assistance role by role. You can try the live demo or take the product tour first." },
];

export const FINAL_CTA = {
  title: "Your organisation has its own way of working. Your operating system should too.",
  lead: "See FabricOS configured around an institution like yours.",
};
