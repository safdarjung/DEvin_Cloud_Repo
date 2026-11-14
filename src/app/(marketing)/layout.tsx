import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/components/marketing/marketing.css";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { BRAND } from "@/components/fabricos/content";
import { HOME_DESCRIPTION, HOME_TITLE, OG_IMAGE, OG_LOCALE } from "@/components/fabricos/seo";

// Child openGraph/twitter objects replace these wholesale, so meta() in
// components/marketing/content.ts repeats siteName and locale.
export const metadata: Metadata = {
  title: { default: HOME_TITLE, template: `%s | ${BRAND}` },
  description: HOME_DESCRIPTION,
  openGraph: { type: "website", siteName: BRAND, locale: OG_LOCALE, title: HOME_TITLE, description: HOME_DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESCRIPTION, images: [OG_IMAGE] },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fabric-mk flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-(color:--mk-accent) focus:px-4 focus:py-3 focus:text-(color:--mk-accent-fg)"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
