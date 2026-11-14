# FabricOS: SEO and AEO strategy

Status: 2026-11-14. Scope: public marketing site (`src/app/(marketing)/**`). Search
research was done with web search on 2026-11-14. No search-volume, ranking or
traffic figures appear in this document: none were measured, and none should be
added without a named data source (for example Search Console or a keyword tool
export) and a date.

## 1. Positioning that the SEO must stay true to

- Brand: **FabricOS**. Primary definition (from `src/components/fabricos/content.ts`
  `DEFINITION`): a configurable, AI-powered operating system for institutions.
- Built and running today for **schools and colleges**. Other sectors are
  configurable use cases and are never described as prebuilt products.
- Honesty limits that also bind metadata and structured data: Razorpay test mode
  only; email and WhatsApp simulated until configured; AI output needs human
  approval; not available: AI credits/BYOK, voice, what-if simulation,
  marketplace, native apps. No ratings, reviews, prices, customer counts or
  certifications in any markup.

## 2. Target topics and search intent

Intent was inferred from what currently ranks for each query (page types in the
results), not from volume data.

| Topic | Observed intent | What ranks (2026-11-14) | Fit for FabricOS |
|---|---|---|---|
| AI-powered operating system for institutions / "AI operating system" for universities | Commercial investigation, early category. Results are vendor pages using "AI operating system" for higher education (ibl.ai, CollegeVine, SEMCOG.ai) and finance (BankSocial). | Vendor product pages, one long-form book chapter. | **Primary brand topic.** Category is new and vendor-defined, so a clear definition ("FabricOS is…") near the top of the home page is the main lever. |
| School management software India | Commercial investigation / comparison. | "Top 10 / best" listicles (mostly vendor-authored), SourceForge comparison, vendor product pages (Jupsoft, OpenEduCat, Schoolites, Entab). | **Strongest product fit today** (education is the live sector). Listicles dominate; a vendor home page competes poorly against them. Needs a dedicated education page, not the home page. |
| School ERP with AI India / AI-powered school management software | Commercial investigation. | Vendor pages each claiming "India's first AI-powered school ERP" (Class ON, NeevLearn, Schoolites); comparison posts. | Good fit. Differentiator to state plainly: AI proposes, people approve; permission-checked agents; local-only AI policy. Avoid "first" claims. |
| College management software / college ERP India | Commercial investigation. | Vendor pages (Academia ERP, Apna Campus). | Fit (colleges are a live sector), but current pages are school-led. |
| Institutional workflow management software | Commercial investigation, higher-ed admin leaning. | Workflow vendors (Kuali, Softdocs, Integrify, Kissflow, ProcessMaker) and "best workflow software" review sites. | Secondary. Competes with dedicated BPM tools. Target through the Workflows/Automation section and FAQ, not as a primary page title. |
| Workflow automation with AI agents / human-in-the-loop approval | Informational + commercial. | Explainers and product pages about approval gates (Airtable, Zapier, Oracle, Airia, Databricks). | Good topical fit for the "AI proposes. People decide." message. Informational intent: suits an explainer page or guide, not the home page. |
| AI agents for organisations | Informational / category. | Same human-in-the-loop explainers and agent-platform vendors. | Supporting topic. Covered by the AI agents section and `/ai`. |
| Configurable enterprise software / AI ERP vs traditional ERP | Informational / comparison. | Vendor-authored "configuration vs customisation" and "AI ERP vs traditional ERP" articles (SysGenPro, Opkey, DOSS, Acumatica). | Supporting. The FAQ answer "How is FabricOS different from traditional ERP software?" targets it directly. |
| Operational insights / AI-powered operations platform | Broad, mixed. | Not researched in depth; generic BI and ops-platform vendors. | Low priority as a search target; keep as section copy. |

Sources (web search, 2026-11-14):
- AI operating system for institutions: <https://ibl.ai/higher-education-overview>, <https://collegevine.com>, <https://my-institution-project.pages.dev/>, <https://banksocial.io/substrate>, <https://openeducat.org/zh/ai/solutions/india/>
- School management software India: <https://jupsoft.com/blog/top-10-school-management-software-in-india-2025>, <https://sourceforge.net/software/school-management/india/>, <https://openeducat.org/k12-school-management-software-in-india/>, <https://www.techjockey.com/blog/?p=19990>, <https://schoolites.com/school-management-software>
- AI school ERP India: <https://classonapp.com/resources/blogs/best-school-erp-software-in-india-2026-complete-guide-for-principals-trustees>, <https://schoolites.com/compare/best-school-management-software-india>, <https://www.academiaerp.com/india/>, <https://sourceforge.net/software/school-erp/india/>
- Institutional workflow management: <https://www.kuali.co/post/workflow-management-software>, <https://softdocs.com/products/workflow>, <https://kissflow.com/appstore/cross-department-process-standardization>, <https://www.softwareadvice.com/workflow/p/all/>
- AI agents with human approval: <https://www.airtable.com/articles/human-in-the-loop-ai-agents>, <https://zapier.com/blog/human-in-the-loop/>, <https://blogs.oracle.com/fusioncoe/human-approval-node-in-workflow-agents>, <https://airia.com/ai-platform/system-controls>
- Configurable software vs ERP: <https://www.opkey.com/blog/erp-configuration-vs-customization>, <https://www.doss.com/news/dosscon1-recap>, <https://www.acumatica.com/blog/ai-on-your-terms-managed-configurable-ai/>

## 3. Page and section to topic map

| URL / section | Primary topic | Secondary topics |
|---|---|---|
| `/` title + H1 area + `#platform` | AI-powered operating system for institutions | configurable operating system, FabricOS |
| `/#ai-agents` | AI agents for organisations | permission-checked AI, human approval |
| `/#automation` | workflow automation with approvals | institutional workflow management |
| `/#insights` | operational insights | attention signals, forecasts |
| `/#use-cases` | education (schools and colleges) | configurable use cases for other institutions |
| `/#human-control` | human-in-the-loop AI | audit trail, AI policy, local-only AI |
| `/#faq` | definitional questions ("What is FabricOS?", "different from ERP") | all of the above |
| `/product`, `/modules` | school management software / school ERP | admissions, attendance, fees, exams modules |
| `/ai` | AI-powered school management | AI agents, AI policy |
| `/security` | multi-tenant data isolation for schools | audit log, roles |
| `/roles` | principal / teacher / parent portal | role-based access |
| `/how-it-works` | onboarding / implementation | configuration |
| `/pricing`, `/demo`, `/contact` | transactional (quote, demo, contact) | — |
| `/tour` | noindex until the owner approves | — |

## 4. Metadata (as shipped)

- Home title: `FabricOS: AI-Powered Operating System for Institutions` (54 chars), `title.absolute`.
- Home description: `DESCRIPTION` from content.ts (150 chars).
- Canonical `/`; Open Graph type website, siteName FabricOS, locale `en_IN`
  (Indian market, Indian/British spelling); Twitter `summary_large_image`.
- Marketing layout: default title = home title, template `%s | FabricOS`.
  `meta()` in `src/components/marketing/content.ts` repeats siteName/locale and
  sets a page-level Twitter title, because child openGraph/twitter objects
  replace the parent's.
- OG image: `src/app/opengraph-image.tsx`, 1200x630, FabricOS mark + tagline +
  positioning. Next drops the root file-based image as soon as a segment sets its
  own `openGraph`, so `OG_IMAGE` (`src/components/fabricos/seo.ts`) is passed
  explicitly as `openGraph.images` and `twitter.images` on every marketing page.
  No separate `twitter-image` route: the proxy only exempts known public segments
  (`src/lib/marketing/routes.ts`), so a new `/twitter-image` route would redirect
  logged-out crawlers to `/login`.

## 5. Structured data inventory

| Where | Entities | Notes |
|---|---|---|
| Every page (root layout) | `Organization` `#organization` (name, url, logo `/icon/512`, description), `WebSite` `#website` (name, url, description, inLanguage, publisher) | Built by `organizationLd` / `websiteLd` in `src/components/seo/json-ld.tsx`. |
| Home (`HomeJsonLd`) | `WebPage` `#webpage`, `SoftwareApplication` `#software`, `FAQPage` `#faq` in one `@graph` | References `#organization` and `#website` by `@id`; no duplicate entities. FAQPage is generated from the `FAQ` array that also renders the visible FAQ. |

Not used on purpose: ratings, reviews, offers/prices, addresses, customer counts,
certifications, `VideoObject` (no video files with real metadata yet), HowTo
(deprecated).

Note on FAQPage: Google retired FAQ rich results for all sites on 2026-05-07, so
the FAQPage node earns no Google SERP feature. It is kept because it is accurate,
mirrors visible copy, and is harmless; do not expect a rich result from it.

## 6. Crawl and index controls

- `robots.txt` disallows `/api/`, `/login`, `/logout`, `/start`, `/select`,
  `/portal`, `/platform`, `/offline`. `/s/<slug>` (public school sites) is allowed.
- `noindex, nofollow` metadata: `(auth)` layout, `(tenant)/[institution]` layout,
  `/platform`, `/select`, `/offline`, `/tour`.
- Tenant paths redirect logged-out visitors to `/login` in the proxy.
- Sitemap lists public marketing URLs only; no `lastmod` (no real per-page date
  source), no priority/changefreq (ignored by Google).
- AI crawlers are allowed (public marketing copy we want represented accurately).
- `public/llms.txt` and `public/for-agents.md` are rewritten for FabricOS. They are
  optional; Google says such files neither help nor hurt Search.

## 7. Remaining recommendations

1. **Education landing page** (`/schools` or `/education`): the strongest
   commercial topic today ("school management software India", "school ERP with
   AI") lands on listicles and vendor product pages. The home page now targets the
   broad category, so education intent needs its own page with module detail,
   honest status labels and a demo CTA. Failure check: no impressions for
   school-management queries in Search Console after indexing.
2. **Search Console + Bing Webmaster Tools** on the production domain, submit
   `/sitemap.xml`, then record real queries before adding more target terms.
3. **Comparison explainer** answering "operating system vs ERP for schools", using
   only verifiable FabricOS facts. Supports the configurable-vs-ERP topic.
4. **Brand entity signals**: add `sameAs` to the Organization only once real
   public profiles (LinkedIn, YouTube) exist.
5. **Videos**: when `src/components/fabricos/videos.ts` ships real files with a
   creation date, add `VideoObject` (name, description, absolute thumbnailUrl,
   contentUrl, uploadDate) to the home graph.
6. **`/tour`**: it is linked from the main nav and CTAs but is not in the proxy's
   public segment list, so logged-out visitors (and crawlers) are redirected to
   `/login` unless demo auto-login is on. Decide whether it is public; if so, add
   `tour` to `MARKETING_SEGMENTS` (a routing change, needs owner sign-off).
7. **Legal drafts** were renamed to FabricOS; legal review should confirm the
   product name used in them.
