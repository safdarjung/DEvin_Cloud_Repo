# Product guide

Fabric (repo name CoolSkool) is a multi-tenant school operating system for Indian private schools. One workspace per institution; access by role.

## Roles (src/lib/auth/permissions.ts)
owner, principal, admin, admissions, accountant, exam_controller, teacher, student, guardian. "Guardian" is the parent. Permissions are a role-to-permission matrix; scoped cells (own sections, own children, self) are enforced by RLS plus handler logic.

## What each role does (summary; check FEATURE_MATRIX for status)
- Owner/principal/admin: settings, members, modules on/off, audit log, dashboards, insights, forecasts, agents.
- Admissions: enquiries, applications, decisions, enrolment.
- Accountant: fee structures, invoices, payments, receipts, reminders, ledger.
- Exam controller: exams, marks verification, result publishing, rechecks.
- Teacher: attendance, marks entry, assignments, AI assistance, diary, timetable.
- Student: portal (results, assignments, attendance, study items, AI study).
- Guardian: portal for children (fees, results, attendance, notifications), PTM booking, leave.

## What each role's AI can do (Phase 3)

Each role has toggleable AI chat and capabilities (configured at `/settings/ai`; chat off by default for guardian, accountant, exam_controller). Draft cards let the AI fill in forms (lesson plans, messages, worksheets, fee reminders); the person reviews and saves via a "Save" button — the AI never writes marks, payments, access, or leave decisions.

- **Teacher:** drafts lesson plans, parent messages; suggests differentiated worksheets; gives hints before full answers; suggests grades for objective homework.
- **Student:** studies with hint mode and weak-area plans; asks in any Indian language (Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia) for simple explanations; reads exam prep and practice items.
- **Guardian:** reads plain-language report-card explanations and last-week summaries of their child's attendance/homework/fees; translates notices; drafts leave requests and messages to staff.
- **Admin/principal/owner:** drafts announcements, PTM events, and fee reminders per family; reviews weekly reports and attendance trends; checks exam mark outliers; builds question papers from the question bank; accesses all staff assistant reads (financials, admissions, timetable).

## Surfaces
- Public marketing site: `/`, `/product`, `/modules`, `/ai`, `/security`, `/pricing`, `/how-it-works`, `/faq`, `/demo`, `/roles`, `/contact`, `/legal/*`.
- Landing page `/` (`src/components/home/`): a scroll film beside a 3D scene drawn in CSS 3D (`scene/`): seven loose paper things float round one product board; each scroll step brings one forward, flips it into the module screen that replaces it (sample data, labelled as an illustration) and docks it into the board, and at the end one thread runs through all seven. The pointer tilts the scene, a card can be clicked to jump to its step or flipped by hand, and the board can play the product film inside itself. With reduced motion it is a stacked page. Then a ribbon of every module name with four catalog counts, use cases with 30-second story films, the five people with one-click demo forms, the AI rules with an "ask it" demo (pick a person and a question; the answer is drawn as a chart, mind map, hints or a week, scripted with sample data and labelled as an illustration) and a spinnable ball of all AI skills, the module quilt with a search box, a loose-threads picker (tick what the school runs on today; it lists the modules that replace it, with their honesty labels, and carries the choice to `/contact?threads=`), trust rules, getting started and "Stated plainly". Sections play in as they scroll into view and a thread under the header shows reading progress; with reduced motion nothing animates and nothing is hidden. One content file feeds the story: `src/components/home/story.ts` (demo script: `ask-demo.ts`; picker mapping: `threads.ts`).
- Pitch deck `/product/deck` (`src/components/present/`, noindex): 15 slides with speaker notes, keyboard and touch navigation, overview, fullscreen, print to PDF.
- Product film: `public/film/fabric.mp4` (86 s, silent, on-screen text), rendered by `pnpm film:render` from the same Remotion composition the site plays.
- 3D school tour `/tour` (noindex): scroll through five rooms; per-role explainer films.
- `/select`: institution picker (auth-gated).
- `/login`: email + password.
- Tenant app: `/<institution>/...` (dashboard, today, students, attendance, admissions, finance, exams, assignments, ai, website, notifications, jobs, settings/modules, me, portal, fabric).
- Public school website: `/s/<slug>` (published content only).
- Mobile: bottom navigation bar (max 5 slots + "More"); installable PWA for the public shell.

## Modules
Catalog in `src/lib/modules/catalog.ts` (about 40 entries, categories Core, Academics, Exams, Admissions & Website, People & HR, Finance+, Operations, Communication, Reports, AI, Intelligence). Core modules are always on; others toggle per institution at `settings/modules`; some declare `requires` (e.g. agents requires ai_teacher).

## Honesty rules
Simulated channels and limited features show a badge (`src/components/honesty.tsx`). Email is Resend when configured, otherwise simulated. SMS is simulated. WhatsApp is simulated for demo institutions and for others until MSG91 keys are set. Razorpay is test mode only. AI output is a suggestion a human saves; AI never writes marks, payments, access or welfare decisions.

## Demo
Seeded demo tenant (`pnpm seed`), demo login buttons, optional `DEMO_AUTO_LOGIN` (env names in .env.example). Demo-tenant fixture widgets show only when `ctx.institution.is_demo`.

Last verified: 2026-11-06 against branch feat/fabric-public-wave1
