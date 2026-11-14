import "@/components/fabricos/fabricos.css";
import Link from "next/link";
import { BRAND, CTA, DESCRIPTION, OVERVIEW, SECTION, TAGLINE } from "@/components/fabricos/content";
import { FabricGlyph } from "@/components/fabricos/fabric-glyph";
import { LEGAL } from "./content";

const GROUPS: readonly { title: string; links: readonly { href: string; label: string }[] }[] = [
  {
    title: "Platform",
    links: [
      { href: `${OVERVIEW}#${SECTION.platform}`, label: "Platform" },
      { href: `${OVERVIEW}#${SECTION.agents}`, label: "AI agents" },
      { href: `${OVERVIEW}#${SECTION.automation}`, label: "Automation" },
      { href: `${OVERVIEW}#${SECTION.insights}`, label: "Insights" },
      { href: `${OVERVIEW}#${SECTION.useCases}`, label: "Use cases" },
      { href: `${OVERVIEW}#${SECTION.trust}`, label: "Human control" },
    ],
  },
  {
    title: "Product",
    links: [
      { href: "/product", label: "Product" },
      { href: "/modules", label: "Modules" },
      { href: "/ai", label: "AI" },
      { href: "/security", label: "Security" },
      { href: "/pricing", label: "Pricing" },
      { href: CTA.tour.href, label: "Product tour" },
      { href: CTA.secondary.href, label: "Live demo" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Contact" },
    ],
  },
  { title: "Legal (drafts)", links: LEGAL },
];

export function SiteFooter() {
  return (
    <footer className="fos border-t border-(color:--fos-line) pt-20 pb-10">
      <div className="mx-auto grid w-full max-w-[1200px] gap-14 px-5 sm:px-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div>
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 text-lg font-semibold tracking-[-0.02em]">
            <FabricGlyph className="size-6" />
            {BRAND}
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-(color:--fos-muted)">{DESCRIPTION}</p>
          <p className="mt-6 text-sm text-(color:--fos-fg)">{TAGLINE}</p>
        </div>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          {GROUPS.map((g) => (
            <nav key={g.title} aria-label={`Footer: ${g.title}`}>
              <p className="text-sm font-medium text-(color:--fos-fg)">{g.title}</p>
              <ul className="mt-3">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="inline-flex min-h-11 items-center text-sm text-(color:--fos-muted) transition-colors hover:text-(color:--fos-fg) md:min-h-9">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-16 flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 border-t border-(color:--fos-line) px-5 pt-8 text-xs text-(color:--fos-muted) sm:px-8">
        <p>
          {BRAND}. Built and running for schools and colleges today.
        </p>
        <Link href={CTA.signIn.href} className="inline-flex min-h-11 items-center hover:text-(color:--fos-fg)">
          {CTA.signIn.label}
        </Link>
      </div>
    </footer>
  );
}
