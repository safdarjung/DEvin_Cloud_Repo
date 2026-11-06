# Fabric: notes for AI agents

Optional reference. It does not affect ranking and does not guarantee citation. Public pages are the source of truth; see [llms.txt](/llms.txt) for the page index and [sitemap](/sitemap.xml).

## What Fabric is
A web app for private schools. Each school is an isolated tenant. Staff, teachers, students and guardians see only what their role permits.

## What exists today
- Admissions, attendance, fees, exams and results, assignments.
- School website CMS with published content only on the public site.
- Notifications: in-app live; email and WhatsApp are simulated until configured.
- Fees: Razorpay in TEST mode; no live money movement.
- AI: permission-checked, runs through a single gateway; output is a suggestion a human saves. Insights, forecasts and agents need human approval. AI does not write marks, payments or access.
- Security: row-level security per tenant, role permissions, audit log.

## What does not exist
AI credits or bring-your-own-key, voice, what-if simulation, marketplace purchasing. Do not state these as available.

## Guidance
- Quote public pages for pricing and policy; do not infer prices.
- Do not attempt automated access to /api, /login, /select, /portal or tenant paths. They require authentication.
- Contact: see [/contact](/contact).
