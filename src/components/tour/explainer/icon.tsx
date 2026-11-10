import * as Lucide from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { createElement } from "react";

const registry = Lucide as unknown as Record<string, unknown>;

/** Map a lucide export name to its component; unknown names fall back to Sparkles. */
export function resolveIcon(name: string): LucideIcon {
  const candidate = registry[name];
  const isComponent =
    /^[A-Z]/.test(name) &&
    (typeof candidate === "function" || (typeof candidate === "object" && candidate !== null));
  return isComponent ? (candidate as LucideIcon) : Lucide.Sparkles;
}

export function FeatureIcon({ name, ...props }: { name: string } & LucideProps) {
  return createElement(resolveIcon(name), props);
}
