"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { fibonacciSphere, rotateYX } from "@/modules/ai/components/orb/orb-layout";

// A tiny version of the orb: a tilted dot sphere, front dots larger and stronger, a few "app" dots bigger.
const MINI_DOTS = fibonacciSphere(44).map((v, i) => {
  const [x, y, z] = rotateYX(v, 0.5, 0.45);
  const depth = (z + 1) / 2;
  return { cx: x.toFixed(3), cy: (-y).toFixed(3), r: ((i % 6 === 0 ? 0.11 : 0.055) * (0.6 + 0.6 * depth)).toFixed(3), opacity: (0.18 + 0.82 * depth).toFixed(2) };
});

// Floating shortcut to the per-role AI screen. Sits above the mobile bottom nav
// (lg:hidden, ~4rem) and bottom-right on desktop. Animation is CSS-only and
// disabled under reduced motion.
export function AskAiLauncher({ institutionSlug }: { institutionSlug: string }) {
  const pathname = usePathname();
  const orb = `/${institutionSlug}/orb`;
  if (pathname === orb || pathname.startsWith(`${orb}/`)) return null;

  return (
    <Link
      href={`${orb}?from=${encodeURIComponent(pathname)}`}
      aria-label="Ask AI"
      className="group fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-(--z-header) flex min-h-11 items-center gap-2 rounded-full border border-border bg-card py-1.5 pr-4 pl-2 text-sm font-medium text-foreground shadow-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:right-6 lg:bottom-6 print:hidden"
    >
      <svg
        aria-hidden
        viewBox="-1.2 -1.2 2.4 2.4"
        className="size-8 shrink-0 fill-current transition-transform duration-500 group-hover:scale-110 motion-safe:animate-[spin_28s_linear_infinite]"
      >
        {MINI_DOTS.map(({ opacity, ...d }, i) => (
          <circle key={i} {...d} opacity={opacity} />
        ))}
      </svg>
      Ask AI
    </Link>
  );
}
