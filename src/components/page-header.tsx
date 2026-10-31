import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
  back,
  compact,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Tighter bottom margin when a tab bar or note sits directly under the header. */
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? "mb-2" : "mb-6"} flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}>
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className="mb-2 inline-flex min-h-10 items-center gap-1 rounded-md text-sm text-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-out) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
