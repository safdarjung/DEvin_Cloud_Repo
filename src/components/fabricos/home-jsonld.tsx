// Home page structured data: one @graph. Organization and WebSite are emitted
// on every page by the root layout (organizationLd / websiteLd); here they are
// referenced by @id only, never redefined. No ratings, reviews, offers,
// prices, addresses, customer counts or certifications.
import { JsonLd, faqPageLd, softwareApplicationLd } from "@/components/seo/json-ld";
import { SITE_URL } from "@/lib/site-url";
import { DEFINITION, FAQ } from "./content";
import { HOME_DESCRIPTION, HOME_TITLE } from "./seo";
import { VIDEOS } from "./videos";

// Date the recordings were made (scripts/fabricos/record-videos.mjs). Update on re-record.
const VIDEO_UPLOAD_DATE = "2026-11-14";

// Real capabilities only, worded from NODES / TRUST in content.ts.
const FEATURES = [
  "Role-scoped workspaces for leaders, administrators, teachers, students and parents",
  "Admissions, attendance, fees, exams, assignments and notices on shared records",
  "Approval workflows: draft, review, approve, publish",
  "AI agents that draft and propose actions within the asker's permissions; a person approves changes",
  "Reminders and routine drafts prepared automatically, waiting for approval where required",
  "Attention signals and forecasts across modules",
  "Append-only audit log of sensitive actions",
  "Per-institution AI policy: cloud models or local-only processing",
];

function node(o: Record<string, unknown>) {
  const rest = { ...o };
  delete rest["@context"];
  return rest;
}

export function HomeJsonLd() {
  const id = (frag: string) => `${SITE_URL}/#${frag}`;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": id("webpage"),
        url: SITE_URL, // matches the emitted canonical (no trailing slash)
        name: HOME_TITLE,
        description: HOME_DESCRIPTION,
        inLanguage: "en-IN",
        isPartOf: { "@id": id("website") },
        publisher: { "@id": id("organization") },
        about: { "@id": id("software") },
        primaryImageOfPage: { "@type": "ImageObject", url: `${SITE_URL}/opengraph-image`, width: 1200, height: 630 },
      },
      node(softwareApplicationLd(SITE_URL, { description: DEFINITION, featureList: FEATURES })),
      {
        ...node(faqPageLd(FAQ.map((f) => ({ question: f.q, answer: f.a })))),
        "@id": id("faq"),
        isPartOf: { "@id": id("webpage") },
      },
      // Real screen recordings only (entries without a file are skipped).
      ...Object.entries(VIDEOS)
        .filter(([, v]) => v.mp4 || v.webm)
        .map(([key, v]) => ({
          "@type": "VideoObject",
          "@id": id(`video-${key}`),
          name: v.title,
          description: v.description,
          thumbnailUrl: v.poster ? `${SITE_URL}${v.poster}` : undefined,
          contentUrl: `${SITE_URL}${v.mp4 ?? v.webm}`,
          uploadDate: VIDEO_UPLOAD_DATE,
          ...(v.durationSec ? { duration: `PT${Math.round(v.durationSec)}S` } : {}),
          isPartOf: { "@id": id("webpage") },
        })),
    ],
  };
  return <JsonLd data={graph} />;
}
