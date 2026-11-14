import { BRAND, DEFINITION, DESCRIPTION } from "@/components/fabricos/content";

// Server component. Renders one JSON-LD block. `<` is escaped so data can
// never close the script tag.
type JsonLdValue = Record<string, unknown>;

export function JsonLd({ data }: { data: JsonLdValue | JsonLdValue[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

const CTX = "https://schema.org";

export function organizationLd(siteUrl: string): JsonLdValue {
  return {
    "@context": CTX,
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: BRAND,
    url: siteUrl,
    logo: `${siteUrl}/icon/512`,
    description: `${BRAND} builds a configurable, AI-powered operating system for institutions, running today for schools and colleges.`,
  };
}

export function websiteLd(siteUrl: string): JsonLdValue {
  return {
    "@context": CTX,
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: BRAND,
    url: siteUrl,
    description: DESCRIPTION,
    inLanguage: "en-IN",
    publisher: { "@id": `${siteUrl}/#organization` },
  };
}

/** For marketing pages. Only describe facts visible on the page. No ratings/reviews/offers. */
export function softwareApplicationLd(
  siteUrl: string,
  o: { description?: string; featureList?: readonly string[] } = {},
): JsonLdValue {
  return {
    "@context": CTX,
    "@type": "SoftwareApplication",
    "@id": `${siteUrl}/#software`,
    name: BRAND,
    publisher: { "@id": `${siteUrl}/#organization` },
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: siteUrl,
    description: o.description ?? DEFINITION,
    ...(o.featureList ? { featureList: o.featureList } : {}),
  };
}

/** For /faq. Q&A text must match the visible page copy. */
export function faqPageLd(items: { question: string; answer: string }[]): JsonLdValue {
  return {
    "@context": CTX,
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
}
