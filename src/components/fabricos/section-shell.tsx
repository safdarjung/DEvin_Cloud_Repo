import type { ReactNode } from "react";
import { cn } from "cn";

/** Shared section frame: anchor id, labelled region, consistent gutters. */
export function SectionShell({
  id,
  className,
  innerClassName,
  children,
}: {
  id: string;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("relative scroll-mt-20 py-20 md:py-28", className)}>
      <div className={cn("mx-auto w-full max-w-[1200px] px-5 sm:px-8", innerClassName)}>{children}</div>
    </section>
  );
}

/** Section h2 plus optional lead. The id pairs with SectionShell's aria-labelledby. */
export function SectionHeading({
  id,
  title,
  lead,
  className,
}: {
  id: string;
  title: string;
  lead?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      <h2 id={`${id}-title`} className="fos-h2" data-reveal>
        {title}
      </h2>
      {lead ? (
        <p className="fos-lead mt-6" data-reveal>
          {lead}
        </p>
      ) : null}
    </div>
  );
}
