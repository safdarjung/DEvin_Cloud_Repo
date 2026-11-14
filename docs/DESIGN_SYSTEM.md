# Design system

## Stack
Tailwind v4 (CSS-first, tokens in src/app/globals.css), shadcn/ui + radix-ui (src/components/ui), lucide-react icons, Recharts (components/ui/chart.tsx), motion (components/motion.tsx), sonner toasts, next-themes (class strategy, `.dark`), cmdk command palette.

## Fonts
Plus Jakarta Sans (`--font-jakarta`, sans and heading) and Geist Mono (`--font-geist-mono`) via next/font/google in src/app/layout.tsx.

## App tokens (globals.css)
Semantic CSS variables: background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, chart-1..5, sidebar-*. Vision UI look. Light: background #f7f6f2, foreground #0e1a2b, primary #582cff, `--radius` 0.75rem. Dark (default, `.dark`): navy #0b1030 background, glass cards (`--glass`), primary #6f4dff, `--radius` 0.9rem. `--brand-glow` is the violet shadow on primary buttons and active chips. Radius scale derived from `--radius`.

## Marketing tokens (src/components/marketing/marketing.css)
Scoped to `.fabric-mk`: --mk-bg, fg, muted, line, surface, accent (#0f6f68 light, #5bbfb3 dark), accent-soft, blue. Dark values switch with the `.dark` class. Components: components/marketing/ui.tsx (PageHero, Section, Rows, CtaBand, ButtonLink), site-header, site-footer, theme-toggle, lead-form.

## Landing, deck and film tokens (src/components/home/tokens.css)
Scoped to `.loom` ("Storybook loom", the look of the 3D tour's explainers): cream paper `--lm-paper`, ink outlines `--lm-ink`, hard offset shadows, yellow `--lm-yellow` for the primary button, one yarn colour per school domain (`--th-attendance`, `--th-fees`, `--th-exams`, `--th-admissions`, `--th-parents`, `--th-learning`, `--th-office`; same values as `THREADS` in `story.ts`). Dark theme keeps cards as paper on a night background. Primitives: `.lm-card`, `.lm-btn`, `.lm-chip`, `.lm-honest` (the honesty label on public pages), `.lm-display`. Display face: Bricolage Grotesque (`src/components/home/fonts.ts`); body stays Plus Jakarta Sans. On `/` the site header and footer take the same paper via `.fabric-mk:has(.lh)`.

## Shared components
page-header, breadcrumbs, states (empty/loading/error), honesty badges (SimulatedBadge, LimitedBadge), tenant sidebar, bottom nav (components/tenant/bottom-nav.tsx; logic in lib/bottom-nav.ts: max 5 slots, 4 + More), widgets/ for dashboards.

## Rules
- Simulated/limited features must show an honesty badge (project rule 7).
- Reuse shadcn primitives before adding components.
- Mobile: tenant shell has bottom nav; marketing pages are responsive (not device-tested).
- Motion: library present; reduced-motion handling not audited here (unverified).

## Not done
No Storybook or token documentation site; contrast, keyboard and screen-reader audits not performed (WCAG unverified). Two token sets (app vs marketing) are intentionally separate and not unified. Public brand name is Fabric; manifest tagline "Intelligence that moves institutions forward." Theme colour in manifest #0b1020.

Last verified: 2026-11-06 against branch feat/fabric-public-wave1
