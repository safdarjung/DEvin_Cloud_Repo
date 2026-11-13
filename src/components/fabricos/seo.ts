// Home page metadata. Copy comes from content.ts so the snippet, the visible
// page and the JSON-LD say the same thing.
import type { Metadata } from "next";
import { BRAND, DESCRIPTION, TAGLINE } from "./content";

/** ≤ 60 chars. Brand first, then the primary topic. */
export const HOME_TITLE = `${BRAND}: AI-Powered Operating System for Institutions`;
/** ≤ 155 chars. */
export const HOME_DESCRIPTION = DESCRIPTION;

// en_IN: the product is built and sold for Indian schools and colleges (INR
// fees, Razorpay) and the copy uses Indian/British spelling ("organisation").
export const OG_LOCALE = "en_IN";

// The root opengraph-image.tsx is dropped by Next as soon as a segment sets its
// own `openGraph`, so marketing metadata names it explicitly (OG and Twitter).
export const OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${BRAND}: ${TAGLINE} A configurable, AI-powered operating system for institutions.`,
};

export const homeMetadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: BRAND,
    locale: OG_LOCALE,
    url: "/",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESCRIPTION, images: [OG_IMAGE] },
  robots: { index: true, follow: true },
};
