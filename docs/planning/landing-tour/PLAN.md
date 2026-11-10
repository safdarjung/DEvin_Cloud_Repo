# School Tour landing + App Orb + debt close-out — plan (2026-11-10)

Owner decisions (2026-11-10): real-time 3D (react-three-fiber) with scroll-driven camera; Remotion Player for
per-role feature explainers; hyperframes renders MP4 fallbacks; procedural mid-poly models in code with
Duolingo-style bouncy character animation; build at `/tour` first, swap to `/` after owner approval;
DBT-157 closed as "keep current design".

Every agent reads `.superpowers/sdd/10-backlog-index/BRIEF-COMMON.md` first. Extra rules for this plan:
- Touch only the files your lane lists. No state-changing git. No new dependencies (all are installed).
- Do not run `pnpm dev`, `pnpm build`, `db:reset`, `seed` unless your lane says so. Verify with
  `pnpm typecheck`, `pnpm lint <your files>`, and your own unit test file.
- Do not edit `docs/planning/coolskool/12-decision-log.md` or `10-backlog-index.md`; put doc notes in your reply.
- Next 16.4: read `node_modules/next/dist/docs` for anything you are unsure of. three 0.187, R3F 9.8, drei 10.7,
  remotion 4.0.542, gsap 3.15, lenis 1.3 are installed; check their `.d.ts` rather than guess.

## Shared contract (all tour lanes code against this exactly)

`src/components/tour/roles.ts` (lane L3 writes it):

```ts
export type TourRoleKey = "principal" | "admin" | "teacher" | "student" | "parent";
export interface TourFeature { title: string; blurb: string; icon: string /* lucide-react export name */; label?: "simulated" | "limited" }
export interface TourRole {
  key: TourRoleKey;
  label: string;        // "Principal", "Administrator", "Teacher", "Student", "Parent"
  room: string;         // "Principal's office", "Front office", "Classroom", "Library", "Parent lounge"
  tagline: string;      // one sentence
  demoEmail: string;    // full address, same values as src/app/(marketing)/demo/page.tsx
  accent: string;       // hex
  features: readonly TourFeature[]; // 5–6 each
}
export const TOUR_ROLES: readonly TourRole[]; // order: principal, admin, teacher, student, parent
```

`src/components/tour/explainer/ExplainerPlayer.tsx` (lane L2): default-exported client component
`ExplainerPlayer({ role, onEnded }: { role: TourRoleKey; onEnded?: () => void })`, fills its parent (16:9).

## L1 — 3D scroll tour (Opus)

Files: `src/app/(marketing)/tour/page.tsx`, `src/components/tour/{SchoolTour.tsx,path.ts,tour.css}`,
`src/components/tour/scene/*`, `tests/unit/tour-path.test.ts`, `e2e/tour.spec.ts`.

- `page.tsx`: server component, metadata, `robots: noindex` until the swap; renders `<SchoolTour />`
  (client, R3F Canvas loaded with `next/dynamic` `ssr:false` inside a client wrapper).
- Layout: one fixed full-viewport Canvas; a tall scroll container (≈ 100vh per segment). Reuse the Lenis +
  GSAP ScrollTrigger pattern from `src/components/landing/film.tsx` to get one `progress` 0..1 (scrubbed,
  smoothed). No scroll-jacking: native scroll length, camera follows.
- `path.ts` (pure, unit-tested first): `STOPS` = gate + 5 role rooms with `[start,end]` progress windows and
  dwell ranges; `stopAt(progress)`; `cameraAt(progress)` → position + lookAt from a `CatmullRomCurve3`
  (camera eases in, dwells inside each room, eases out). Tests: monotonic, every stop reachable, dwell windows
  do not overlap, progress 0 = outside gate, progress 1 = parent lounge.
- Scene (procedural, mid-poly, rounded, flat bright colours, soft shadows; Duolingo feel = chunky shapes,
  squash-and-stretch, springy overshoot, blinking mascots):
  - Exterior: school building, sign, flag waving, trees, clouds, gate that swings open as scroll starts.
    Before scrolling it is a toy: pointer parallax, hover wiggle on trees/bell/flag, click bell = ring bounce.
  - Corridor linking rooms (lockers, notice board, doors that open as the camera nears).
  - Five rooms, each with props that say the role and one mascot character doing a looped action:
    principal (desk, dashboard screen, trophy), admin (counter, files, fee receipts), teacher (board, desks),
    student (library desk, books, tablet), parent (sofa, phone, report card).
  - One shared `Mascot` component (capsule body, big eyes, blink, bob, wave) recoloured per role.
- DOM overlay per stop (fades in during dwell): room name, role label, tagline, **Show features** button →
  opens a panel with `<ExplainerPlayer role />`; when it ends show "Next: <role>" (scrolls to next stop).
  **Try the <role> demo** = plain `<form method="post" action="/api/public/demo-login">` with hidden `email`
  (same pattern as `src/app/(marketing)/demo/role-card.tsx`; no JS handler). Progress rail with 6 dots.
- Performance: `dpr={[1,1.75]}`, `frameloop="demand"` driven by scroll/pointer invalidation plus a ticker only
  while animations run, instanced repeats, no textures over 512px, no postprocessing in v1.
- Fallback (no WebGL, `prefers-reduced-motion`, or width < 900px portrait): static stacked sections with the
  same copy, `<video>` from `public/tour/<role>.mp4` if present, and the same demo forms. Keyboard + screen
  reader path must reach every button; canvas is `aria-hidden`.
- `e2e/tour.spec.ts`: page loads, five demo forms exist with the right emails, Show features opens a panel.

## L2 — Feature explainers (Sonnet)

Files: `src/components/tour/explainer/*`, `scripts/tour/render-fallbacks.*`, `public/tour/*.mp4`,
`tests/unit/tour-explainer.test.ts`.

- One Remotion composition `RoleExplainer` (1280×720, 30fps), data-driven from `TOUR_ROLES`: title card →
  one beat per feature (icon pops in with spring, title, blurb, a simple animated mock tile) → end card
  "Try the <role> demo". Duration = pure function of feature count (unit-test it). `simulated`/`limited`
  features show that word on their beat (rule 7).
- `ExplainerPlayer`: `@remotion/player` `<Player>` with controls, autoplay on open, `onEnded` via player ref
  event; lazy-loaded so remotion stays out of the first bundle.
- Fallback MP4s: use `hyperframes` (devDependency CLI, see `node_modules/hyperframes` README) to render one
  short MP4 per role into `public/tour/<role>.mp4` (≤ 1.5 MB each, 720p). Script at
  `scripts/tour/render-fallbacks.*`, wired as `pnpm tour:render` (you may add this one script line to
  package.json). If the render cannot run here after two tries, leave the script, skip the MP4s, report why.

## L3 — Role content (Haiku)

File: `src/components/tour/roles.ts` only. Exact contract above. Features must be things that exist in this
repo: take them from `src/lib/nav.ts`, `docs/planning/coolskool/03-*.md` §1 feature matrix and
`src/modules/ai/capabilities/catalog.ts`. Anything the matrix marks `sim`/`limited` gets the matching `label`.
Plain English, no hype words, blurb ≤ 90 chars. Emails copied from `src/app/(marketing)/demo/page.tsx`.

## L4 — App Orb tab for every role (Sonnet)

Files: `src/app/(tenant)/[institution]/orb/page.tsx`, `src/modules/ai/components/orb/*`, `src/lib/nav.ts`
(one nav item + portal allow-list entry), `tests/unit/orb-layout.test.ts`, nav unit tests if counts change.

- Server page: `getTenantContext()`; apps = `navItemsFor(...)` for this user minus `/orb`; capabilities =
  `enabledCapabilities(ctx)` with labels from the catalog; chat endpoint chosen exactly the way the existing
  role pages choose it (assistant / teacher / student routes over the shared kernel). If the role's chat is
  off, the orb still works as a launcher and says AI is off (no fake chat).
- Page chrome: nothing but the orb, a one-line input, and capability chips.
- Orb (R3F): app tiles (icon + label) on a Fibonacci sphere, slow auto-rotate, drag to spin, hovered tile
  bulges out (spring scale + push along normal, neighbours nudge), click/Enter navigates. Pure layout maths
  in `orb-layout.ts`, unit-tested first.
- Core: displaced icosphere inside the tiles; wave amplitude/speed map to chat state — idle (slow breathing),
  typing, submitted, streaming (strong ripples), error (brief shake). Driven by `useChat` `status`.
- Chat: `useChat` against the role endpoint; replies in a small transcript above the input; reuse the existing
  message/draft renderers (`ActionDraftCard`, `ProviderBadge`) — no new AI route, no new model call path
  (rule 6). Capability chips prefill/send a starter prompt for that capability.
- Nav: `{ href: "/orb", label: "Orb", group: "Overview" }` gated on a permission every role holds
  (`notification.read`); add to `PORTAL_NAV_HREFS`.
- Fallback (no WebGL / reduced motion): accessible grid of the same app links + the same chat. All tiles are
  reachable by keyboard via a visually-hidden link list.

## L5 — DBT-153 + DBT-159 (Sonnet, the only DB owner)

Migrations `20261028000111_mastery_compute_chunked.sql`, `20261028000112_ai_usage_aggregates.sql`.
- DBT-153: `mastery.compute` job handler computes per class section (one statement per section, progress
  survives a retry) instead of one tenant-wide PostgREST call. Result identical to today's (db test proves it).
- DBT-159: `checkLimits`, `usageSummary`, `usageByRole` use SQL aggregate functions (`security invoker`, RLS
  applies) instead of summing PostgREST rows capped at 1000. db test with > 1000 events.
- `pnpm db:types`, commit-ready `src/lib/db/types.ts`. Report the backlog-index §3 lines to add.

## L6 — DBT-160 study preferences page (Sonnet)

`src/app/(tenant)/[institution]/settings/study-preferences/page.tsx` (student only) + a small client form in
`src/modules/ai/components/`. Language picker from the catalog's language list, saved through the existing
student style action (find it in `src/modules/ai/student-study.actions.ts`; add a schema field only if
missing). Unit test for the schema, permission check in the page, link from the student study screen.
No migration (L5 owns the DB).

## Lead (main session) after lanes return

Review diffs, run `pnpm lint && pnpm typecheck && pnpm test`, run dev + screenshots of `/tour` and `/orb`,
fix rounds, T-045 honesty-label + a11y/responsive pass on the new pages, close DBT-153/157/158/159/160 in the
decision log, commit, push. Hosted rehearsal, backup recording and `supabase db push` of 0111/0112 stay with the owner.
