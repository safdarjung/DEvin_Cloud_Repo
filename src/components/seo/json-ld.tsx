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
    name: "Fabric",
    url: siteUrl,
    logo: `${siteUrl}/icon/512`,
  };
}

export function websiteLd(siteUrl: string): JsonLdValue {
  return {
    "@context": CTX,
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: "Fabric",
    url: siteUrl,
    publisher: { "@id": `${siteUrl}/#organization` },
  };
}

/** For marketing pages. Only describe facts visible on the page. No ratings/reviews. */
export function softwareApplicationLd(
  siteUrl: string,
  o: { description: string; featureList?: string[] },
): JsonLdValue {
  return {
    "@context": CTX,
    "@type": "SoftwareApplication",
    name: "Fabric",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: siteUrl,
    description: o.description,
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
