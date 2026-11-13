"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Live monitor: re-runs the server page's queries on a timer. */
export function AutoRefresh({ everyMs = 10_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
