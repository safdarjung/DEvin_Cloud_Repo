import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";

export const REVEAL = "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 duration-500";

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  arrow = false,
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  arrow?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--mk-accent)",
        variant === "primary"
          ? "bg-(color:--mk-accent) text-(color:--mk-accent-fg) hover:opacity-90"
          : "border border-(color:--mk-line) text-(color:--mk-fg) hover:bg-(color:--mk-surface)",
        className,
      )}
    >
      {children}
      {arrow && <ArrowRight className="size-4" aria-hidden />}
    </Link>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold tracking-[0.14em] text-(color:--mk-accent) uppercase">{children}</p>;
}

/** Page opener: the single H1 of a page. */
export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children?: ReactNode }) {
  return (
    <section className="border-b border-(color:--mk-line) py-14 sm:py-20">
      <Container className={REVEAL}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-3 max-w-3xl text-3xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-(color:--mk-muted) sm:text-lg">{lead}</p>
        {children && <div className="mt-8 flex flex-wrap gap-3">{children}</div>}
      </Container>
    </section>
  );
}

export function Section({
  id,
  title,
  lead,
  children,
  tint = false,
}: {
  id?: string;
  title: string;
  lead?: string;
  children: ReactNode;
  tint?: boolean;
}) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section id={id} aria-labelledby={hid} className={cn("py-14 sm:py-20", tint && "bg-(color:--mk-surface)")}>
      <Container>
        <h2 id={hid} className="max-w-2xl text-2xl font-semibold tracking-[-0.015em] text-balance sm:text-3xl">
          {title}
        </h2>
        {lead && <p className="mt-3 max-w-2xl leading-relaxed text-(color:--mk-muted)">{lead}</p>}
        <div className="mt-8">{children}</div>
      </Container>
    </section>
  );
}

export interface Row {
  title: string;
  body: string;
  tag?: string;
}

/** Ruled two-column rows — a list, not a wall of cards. */
export function Rows({ items }: { items: readonly Row[] }) {
  return (
    <dl className="divide-y divide-(color:--mk-line) border-y border-(color:--mk-line)">
      {items.map((r) => (
        <div key={r.title} className="grid gap-1 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
          <dt className="flex flex-wrap items-center gap-2 font-semibold">
            {r.title}
            {r.tag && (
              <span className="rounded border border-(color:--mk-line) px-1.5 py-0.5 text-[11px] font-medium text-(color:--mk-muted)">
                {r.tag}
              </span>
            )}
          </dt>
          <dd className="leading-relaxed text-(color:--mk-muted)">{r.body}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 max-w-3xl border-l-2 border-(color:--mk-accent) bg-(color:--mk-accent-soft) px-4 py-3 text-sm leading-relaxed">
      {children}
    </p>
  );
}

export function CtaBand({ title = "See FabricOS on a demo school." }: { title?: string }) {
  return (
    <section aria-labelledby="cta-h" className="border-t border-(color:--mk-line) py-14 sm:py-20">
      <Container className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h2 id="cta-h" className="text-2xl font-semibold tracking-[-0.015em] sm:text-3xl">
            {title}
          </h2>
          <p className="mt-2 max-w-xl text-(color:--mk-muted)">Walk through the modules with sample data, or tell us about your institution.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/contact" arrow>
            Book a Demo
          </ButtonLink>
          <ButtonLink href="/demo" variant="secondary">
            Try the demo
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
