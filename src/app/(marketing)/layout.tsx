import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/components/marketing/marketing.css";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export const metadata: Metadata = {
  title: { default: "Fabric — Intelligence That Moves Institutions Forward", template: "%s | Fabric" },
  description: "Fabric runs admissions, attendance, fees, exams and more for your institution, with an AI layer that suggests and people decide.",
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
