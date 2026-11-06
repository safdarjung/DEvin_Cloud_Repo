import Link from "next/link";
import { LEGAL, NAV, NAV_MORE } from "./content";
import { Container } from "./ui";

const linkCls = "inline-flex min-h-11 items-center text-sm text-(color:--mk-muted) hover:text-(color:--mk-fg) focus-visible:outline-2 focus-visible:outline-(color:--mk-accent) md:min-h-8";

export function SiteFooter() {
  return (
    <footer className="border-t border-(color:--mk-line) bg-(color:--mk-surface) py-12">
      <Container className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="text-lg font-semibold">Fabric</p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-(color:--mk-muted)">Intelligence that moves institutions forward.</p>
        </div>
        <nav aria-label="Footer">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-(color:--mk-muted)">Explore</p>
          <ul className="mt-2">
            {[...NAV, ...NAV_MORE, { href: "/contact", label: "Contact" }].map((n) => (
              <li key={n.href}>
                <Link href={n.href} className={linkCls}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Legal">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-(color:--mk-muted)">Legal (drafts)</p>
          <ul className="mt-2">
            {LEGAL.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className={linkCls}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </footer>
  );
}
