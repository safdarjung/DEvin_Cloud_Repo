import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/result";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import type { PaperStatus } from "@/modules/question-papers/schemas";

export const PAPER_STATUS_LABEL: Record<PaperStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};
export const PAPER_STATUS_VARIANT: Record<PaperStatus, "secondary" | "warning" | "success" | "outline" | "default"> = {
  draft: "secondary",
  in_review: "warning",
  approved: "success",
  published: "default",
  archived: "outline",
};

/** Unwraps an ActionResult; shows one toast and returns null on failure. */
export async function run<T>(result: Promise<ActionResult<T>>): Promise<T | null> {
  const r = await result;
  if (!r.ok) {
    toast.error(actionErrorMessage(r.error));
    return null;
  }
  return r.data;
}

export const fmtMarks = (n: number) => String(Math.round(n * 100) / 100);

export const SELECT_CLASS = "h-11 w-full rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/** "1, 3-5" -> [1,3,4,5]; undefined when empty or not a chapter list. */
export function parseChapters(text: string): number[] | undefined {
  const out = new Set<number>();
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/.exec(part);
    if (!m) return undefined;
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (a < 1 || b < a || b > 99 || b - a > 19) return undefined;
    for (let n = a; n <= b; n += 1) out.add(n);
  }
  return out.size ? [...out].slice(0, 20) : undefined;
}
