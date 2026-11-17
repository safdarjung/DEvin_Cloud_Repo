// T-024 — website seed section (05 §8, §8.1): home/about/admissions/contact
// pages published, 5 notices, 4 events dated November-December 2026.
// Deterministic ids (uuidV5) like every other section — a rerun upserts
// the same rows instead of duplicating them.
import type { Block } from "../../../src/modules/website/blocks.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// J-01 (08 §4) asserts this exact string never appears in rendered HTML —
// it lives only in an unpublished v2 of the home page, never in the
// published v1 that `pages.published_version_id` points to (C-80, T5).
export const DRAFT_ONLY_MARKER = "Coming soon: our new science wing and robotics lab open for the 2027 session.";

interface PageSpec {
  slug: string;
  title: string;
  navLabel: string;
  blocks: Block[];
}

const PAGES: PageSpec[] = [
  {
    slug: "home",
    title: "Home",
    navLabel: "Home",
    blocks: [
      {
        type: "hero",
        heading: "Fabric School",
        subheading: "CBSE-affiliated, budget-friendly, Chennai.",
        cta: { label: "Apply for admission", href: "/admissions" },
      },
      {
        type: "stats",
        heading: "Fabric School at a glance",
        items: [
          { label: "Students", value: "3,024" },
          { label: "Teaching staff", value: "100" },
          { label: "Grades", value: "I - XII" },
          { label: "Years", value: "35+" },
        ],
      },
      { type: "notice_list", heading: "Latest notices", limit: 5 },
      { type: "event_list", heading: "Upcoming events", limit: 4 },
    ],
  },
  {
    slug: "about",
    title: "About",
    navLabel: "About",
    blocks: [
      {
        type: "rich_text",
        nodes: [
          { type: "heading", level: 2, text: "About us" },
          {
            type: "paragraph",
            spans: [
              {
                text: "Fabric School has served students from Grade I to XII under the CBSE board for over three decades.",
              },
            ],
          },
          {
            type: "list",
            ordered: false,
            items: ["CBSE affiliated", "72 class sections across 12 grades", "100 teaching staff"],
          },
        ],
      },
    ],
  },
  {
    slug: "admissions",
    title: "Admissions",
    navLabel: "Admissions",
    blocks: [
      { type: "hero", heading: "Admissions 2026-27", subheading: "Enquire below; our admissions office will call you." },
      { type: "enquiry_form", heading: "Admission enquiry", ctaLabel: "Submit enquiry" },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    navLabel: "Contact",
    blocks: [
      {
        type: "contact",
        heading: "Contact us",
        address: "12 Convent Road, Chennai, Tamil Nadu 600001",
        phone: "9800000000",
        email: "admissions@st-josephs-demo.coolskool.test",
      },
    ],
  },
];

const NOTICES = [
  { title: "Term 2 begins", body: "Term 2 classes resume from 1 October 2026.", publishAt: "2026-09-25T09:00:00+05:30" },
  { title: "Half-Yearly results published", body: "Half-Yearly 2026 results are now available to parents.", publishAt: "2026-10-05T10:00:00+05:30" },
  { title: "Parent-teacher meeting", body: "PTM for all grades on 15 November 2026, 9am-1pm.", publishAt: "2026-11-01T09:00:00+05:30" },
  { title: "Winter break schedule", body: "School closes for winter break from 20 December 2026.", publishAt: "2026-11-15T09:00:00+05:30" },
  { title: "Annual day rehearsals", body: "Rehearsals for Annual Day begin from 1 December 2026.", publishAt: "2026-11-20T09:00:00+05:30" },
];

const EVENTS = [
  { title: "Parent-Teacher Meeting", startsAt: "2026-11-15T09:00:00+05:30", endsAt: "2026-11-15T13:00:00+05:30", location: "School auditorium" },
  { title: "Annual Sports Day", startsAt: "2026-11-28T08:00:00+05:30", endsAt: "2026-11-28T17:00:00+05:30", location: "School grounds" },
  { title: "Annual Day Celebration", startsAt: "2026-12-12T16:00:00+05:30", endsAt: "2026-12-12T19:00:00+05:30", location: "School auditorium" },
  { title: "Winter Break Begins", startsAt: "2026-12-20T00:00:00+05:30", endsAt: null, location: null },
];

export async function run(ctx: SeedContext): Promise<void> {
  const websiteId = uuidV5("website", "site");
  await ctx.admin.from("websites").upsert({
    id: websiteId,
    institution_id: ctx.institutionId,
    is_live: true,
    theme: null,
    nav: PAGES.map((p) => ({ label: p.navLabel, path: p.slug === "home" ? "/" : `/${p.slug}` })),
  });

  for (const spec of PAGES) {
    const pageId = uuidV5("website", `page:${spec.slug}`);
    await ctx.admin.from("pages").upsert({
      id: pageId,
      institution_id: ctx.institutionId,
      website_id: websiteId,
      slug: spec.slug,
      title: spec.title,
    });

    const versionId = uuidV5("website", `page-version:${spec.slug}:1`);
    await ctx.admin.from("page_versions").upsert({
      id: versionId,
      institution_id: ctx.institutionId,
      page_id: pageId,
      version_no: 1,
      blocks: spec.blocks,
      published_at: "2026-09-01T00:00:00+05:30",
    });

    // guard_pages_published_version (0010) blocks this UPDATE outside
    // `app.allow_publish` — same transaction-scoped guard app.publish_page
    // itself uses, set via the direct `sql` connection (PostgREST doesn't
    // expose `set_config`).
    await ctx.sql.begin(async (tx) => {
      await tx`select set_config('app.allow_publish', 'on', true)`;
      await tx`update public.pages set published_version_id = ${versionId}::uuid where id = ${pageId}::uuid`;
    });
  }

  // C-80/T5 fixture: an unpublished v2 of the home page carrying a marker
  // string J-01 asserts is absent from the rendered page. Never touches
  // `pages.published_version_id` — v1 (above) stays the published version.
  const draftVersionId = uuidV5("website", "page-version:home:2");
  await ctx.admin.from("page_versions").upsert({
    id: draftVersionId,
    institution_id: ctx.institutionId,
    page_id: uuidV5("website", "page:home"),
    version_no: 2,
    blocks: [
      {
        type: "rich_text",
        nodes: [{ type: "paragraph", spans: [{ text: DRAFT_ONLY_MARKER }] }],
      },
    ] satisfies Block[],
    published_at: null,
  });

  await ctx.admin.from("notices").upsert(
    NOTICES.map((notice, index) => ({
      id: uuidV5("website", `notice:${index}`),
      institution_id: ctx.institutionId,
      title: notice.title,
      body: notice.body,
      publish_at: notice.publishAt,
      is_public: true,
    })),
  );

  await ctx.admin.from("events").upsert(
    EVENTS.map((event, index) => ({
      id: uuidV5("website", `event:${index}`),
      institution_id: ctx.institutionId,
      title: event.title,
      starts_at: event.startsAt,
      ends_at: event.endsAt,
      location: event.location,
      is_public: true,
    })),
  );
}
