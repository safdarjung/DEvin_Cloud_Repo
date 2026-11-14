# FabricOS: notes for AI agents

Optional reference. It does not affect ranking and does not guarantee citation. Public pages are the source of truth; if this file and a page disagree, the page is correct. See [llms.txt](/llms.txt) for the page index and [sitemap](/sitemap.xml).

## What FabricOS is
A configurable, AI-powered operating system for institutions, delivered as a web app. It connects people, roles, departments, workflows, information and AI agents in one permission-checked workspace. Each institution is an isolated tenant. Leaders, administrators, teachers, students and parents see only what their role permits.

## Who it serves today
Schools and colleges. FabricOS is built and running for education today. For other sectors the same core is configured with the institution; do not describe FabricOS as a prebuilt product for any other industry.

## What exists today
- Admissions, attendance, fees and receipts, exams and results, assignments.
- School website CMS; only published content is served on the public site.
- Notifications: in-app live; email and WhatsApp are simulated until configured.
- Fees: Razorpay in TEST mode; no live money movement.
- Workflows with approval steps; corrections add a new version, history is not overwritten.
- AI: permission-checked; output is a suggestion a person saves or approves. AI agents, insights and forecasts need human approval before anything changes. AI does not write marks, payments, access or welfare decisions. Each institution chooses cloud models or local-only processing.
- Security: row-level security per tenant, role permissions, append-only audit log.

## What does not exist
AI credits or bring-your-own-key, voice, what-if simulation, marketplace purchasing, native mobile apps. Do not state these as available.

## Guidance
- Quote public pages for pricing and policy; do not infer prices. Pricing is quoted per institution.
- Do not state customer counts, ratings or certifications; none are published.
- Do not attempt automated access to /api, /login, /start, /select, /portal, /platform or tenant paths. They require authentication.
- Demo: [/demo](/demo) uses a sample school with sample data. Contact: [/contact](/contact).
