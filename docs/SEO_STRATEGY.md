# SEO strategy

Status: technical foundation implemented; content strategy below is a proposal. No rankings, traffic or Search Console data exist.

## Audiences
Owners/trustees and principals of budget-conscious Indian private schools (buyers); admin/accounts staff (evaluators); teachers and parents (users, rarely searchers); AI assistants/crawlers summarising the product.

## Intent map (proposed)
| Intent | Page type | Existing page |
|---|---|---|
| Evaluate school management software | product / modules | /product, /modules |
| Compare options, cost | pricing, FAQ | /pricing (quote-based, no prices), /faq |
| Trust: data safety, AI use | security, AI | /security, /ai |
| Role-specific fit | roles | /roles |
| Ready to talk | demo / contact | /demo, /contact |
| How-to problems (fee reminders, attendance, results) | guides | planned / not implemented |

## Proposed topic clusters (planned / not implemented)
Fee management and receipts; attendance and absence follow-up; exam results and rechecks; admissions enquiry handling; parent communication (WhatsApp/email); AI in schools with data-privacy limits; school website for admissions.

## Keyword demand
UNVALIDATED - needs real research (Search Console / third-party tools). No volumes, difficulty or competitor claims are made here.

## Crawler policy (src/app/robots.ts, as implemented)
User-agent * allow /; disallow /api/, /login, /logout, /select, /portal, /offline. Sitemap: `{APP_URL}/sitemap.xml`. AI/training crawlers (GPTBot, Google-Extended, CCBot) are not blocked; revisit by adding per-bot disallow rules. Tenant pages and (auth) layouts emit noindex meta. robots.txt is advisory only.

## Sitemap (src/app/sitemap.ts)
16 URLs: /, /product, /modules, /ai, /security, /pricing, /how-it-works, /faq, /demo, /roles, /contact, plus /legal/{privacy,terms,cookies,data-processing,acceptable-use}. No lastModified (no real source). Public school sites `/s/<slug>` are not in the sitemap.

## Structured data (as implemented)
Site-wide in src/app/layout.tsx: Organization and WebSite JSON-LD (name "Fabric", logo /icon/512). Helpers softwareApplicationLd and faqPageLd exist in src/components/seo/json-ld.tsx but are not used on any page. Note: the root layout emits the site-wide JSON-LD on every route, including tenant pages (noindexed). No ratings or reviews markup.

## Metadata
`meta()` in components/marketing/content.ts sets title, description, canonical (path, resolved via metadataBase = APP_URL) and Open Graph. Dynamic OG image (opengraph-image.tsx), icons, manifest.

## AI-agent files
public/llms.txt and public/for-agents.md. Optional; they do not influence Google Search and carry no ranking guarantee (the files say so). They state what is not available (credits, BYOK, voice, what-if, marketplace).

## Authority and local SEO (principles only)
Earn links and mentions from real schools, education publications and partners. Local presence (Google Business Profile, citations) only for real business locations the owner controls. Do not fabricate reviews, testimonials, profiles, case studies or ratings; do not publish customer names without consent. None of this exists yet.

## Measurement plan (needs owner credentials)
Google Search Console (verify APP_URL domain, submit sitemap), Google Analytics or a privacy-friendly alternative, Bing Webmaster Tools. Track: indexed pages, impressions/clicks per cluster, /contact + /demo submissions (platform_leads rows), Core Web Vitals from CrUX. None connected today. Lighthouse/CWV not measured (no Chrome in this env).

## Cautions
Set APP_URL in production or canonicals and sitemap point at localhost. Legal pages are unreviewed copy.

Last verified: 2026-11-06 against branch feat/fabric-public-wave1
