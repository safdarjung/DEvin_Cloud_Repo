# Feature matrix

Status vocabulary: Complete and tested / Implemented but unverified / Partially implemented / UI-only (mock data) / Planned / Blocked by external dependency.

"Complete and tested" means: merged to main and covered by a recorded gate (.superpowers/sdd/gate-*.txt, HANDOFF.md) or by tests in tests/. Not re-run on this branch (local vitest fails; see KNOWN_LIMITATIONS). Module keys from src/lib/modules/catalog.ts. Role names abbreviated: Own owner, Pri principal, Adm admin, Aso admissions, Acc accountant, Exc exam_controller, Tch teacher, Stu student, Gdn guardian.

| Feature | Status | Roles | Dependencies |
|---|---|---|---|
| Tenant auth, membership, permission matrix, audit log | Complete and tested | all | Supabase Auth |
| People: students, guardians, staff, enrolment (M-people) | Complete and tested | Own/Pri/Adm/Aso | RLS |
| Academic structure, attendance (daily + period) | Complete and tested | Adm/Tch | timetable for period |
| Admissions pipeline + public enquiry form | Complete and tested | Aso/Pri | /api/public/enquiry |
| Fees: structures, invoices, payments, receipts, ledger, reminders | Complete and tested | Acc/Own | immutable-history triggers |
| Online fee payment (Razorpay) | Blocked by external dependency | Gdn/Acc | test mode only; live keys not set; falls back to "simulated" |
| Finance+ (M12) | Complete and tested (per HANDOFF gates) | Acc | finance_plus |
| Exams, marks, results publish, rechecks, report card HTML, question bank | Complete and tested | Exc/Tch/Stu/Gdn | exams |
| Exam seating + admit cards (X06) | Complete and tested | Exc | exams |
| Assignments + submissions + grading | Complete and tested | Tch/Stu | assignments |
| Timetable, lesson plans, substitution, staff attendance, leave | Complete and tested | Adm/Tch | modules requires chain |
| Student lifecycle, certificates + ID cards (X02) | Complete and tested | Adm | |
| Library (X03), visitors + gate pass (X07), facilities, transport, calendar | Complete and tested | Adm | |
| Student leave + class diary (X01), PTM + surveys (X08) | Complete and tested | Gdn/Tch/Adm | |
| Announcements, notification preferences, notification log | Complete and tested | all | |
| Email (Resend) | Blocked by external dependency | Adm | RESEND_API_KEY; else status simulated |
| SMS | Partially implemented | Adm | simulated channel only (simulatedSms) |
| WhatsApp (X05) | Blocked by external dependency | Adm | MSG91_AUTH_KEY + MSG91_WA_NUMBER; else simulated |
| School website CMS + public site /s/<slug> | Complete and tested | Adm/Pri | website module; e2e specs exist |
| CSV import/export, documents/storage, onboarding | Complete and tested | Adm/Own | |
| Scheduled reports (M15), dashboards + approvals (M16) | Complete and tested | Own/Pri | job runner |
| Backup/restore drill scripts (M18) | Implemented but unverified | Own | scripts/db-*.ts; needs DB URL |
| AI Teacher / AI Student / briefings (quiz, remark, enquiry reply, attendance insight, dashboard briefing) | Complete and tested | Tch/Stu/Pri | AI provider reachable (Ollama or cloud key) |
| Insights (M19) | Complete and tested (gate-M19) | Pri/Own | insights |
| Forecasts (M21), Agents (M22) | Implemented but unverified | Pri/Own | agents requires ai_teacher; no separate gate file found for M21/M22 in .superpowers/sdd |
| Mastery (M20), Workflows (M23), Assistant (M24), Late fees (X04) | Planned | | WIP on lane-c/g/j/i, unmerged |
| /fabric/* 12 pages (agents, data, finance-intel, insights, learning, marketplace, operations, simulator, students, studio, trust, twin) | UI-only (mock data) | tenant members | fixtures in src/modules/fabric/demo |
| Marketing site (15 pages + 5 legal) | Implemented but unverified | public | no Lighthouse run |
| Lead capture /api/public/lead | Implemented but unverified | public | migration 0100 not on hosted; unit test lead-schema exists |
| PWA (manifest, sw.js, /offline) | Implemented but unverified | public | no real-device test |
| SEO files (sitemap, robots, llms.txt, for-agents.md, JSON-LD) | Implemented but unverified | public | |
| Mobile bottom nav | Implemented but unverified | tenant members | unit test bottom-nav exists |
| AI credits wallet, BYOK | Planned | | not in code |
| Speech / TTS / STT | Planned | | not in code |
| Scenario / what-if engine | Planned | | not in code |
| Health endpoint, error monitoring | Planned | | not in code |

Notes
- Row grouping is mine; status for grouped rows follows the HANDOFF "done" table and gate files, not a per-feature test audit.
- Real-device, accessibility audit (WCAG) and Lighthouse results do not exist for any row.

## UI redesign pass (2026-11-06) — what changed

Verified = typecheck + `pnpm build` passed. Nothing below was exercised in a browser: no `.env.local` and no local Supabase in this environment, so login, demo and the five dashboards are **untested at runtime**. Unit tests could not run (vitest startup error `code.charCodeAt is not a function`, vite 8 / vitest 5). Lint was not run on touched files.

| Change | Files | State |
|---|---|---|
| Post-login redirect falls back to `/select` (was marketing `/`) | `src/app/(auth)/login/actions.ts` | typechecked, untested |
| `/demo` role cards sign in directly as one allow-listed demo account; hero CTA "Try a demo" | `src/app/(marketing)/demo/*`, `(marketing)/page.tsx` | typechecked, untested |
| Fixture-only Fabric pages (Student success, Simulator, Digital twin, Marketplace, Studio) removed from nav and command palette; pages and code kept | `src/lib/nav.ts` | typechecked |
| "Planned" placeholder tiles hidden (mastery, budgets, late fees, connectors, lineage, model registry, consent) | `src/modules/fabric/components/fabric-sections.tsx` | typechecked |
| Marketplace promo removed from principal dashboard | `dashboard/page.tsx` | typechecked |
| Tokens: warm off-white / graphite-navy, muted teal primary; polish (tabular numbers, balanced text, press feedback, linked-card hover) | `src/app/globals.css` | built, not eyeballed in light/dark |
| Shared `VARIANTS` + `Reveal` motion helpers; "Demo mode" header badge; dashboard/today skeletons | `motion.tsx`, `header.tsx`, `*/loading.tsx` | typechecked |

Not done (needs backend or a separate pass): teacher lesson-plan/materials/grading/quiz-attempt UI; student self-practice quiz and curriculum topic level; community (no tables/RLS/moderation exist); PTM page (backend exists, no page); per-role dashboard split for admin; three.js visual (not installed, skipped); full login-page redesign.

Last verified: 2026-11-06 against branch feat/fabric-public-wave1
