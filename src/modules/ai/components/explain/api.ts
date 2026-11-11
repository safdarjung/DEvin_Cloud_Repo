// Client calls for /anatomy, /teardown and /infographic. Each returns the
// route's ActionResult envelope unchanged, or a dependency_failed envelope
// when the server cannot be reached.
import { fail, type ActionResult } from "@/lib/actions/result";
import type { z } from "zod";
import type { AnatomyRequestSchema, AnatomyResponse, InfographicRequestSchema, InfographicResponse } from "@/modules/ai/explain/schemas";

export type AnatomyInput = z.input<typeof AnatomyRequestSchema>;
export type InfographicInput = z.input<typeof InfographicRequestSchema>;

async function post<T>(path: string, body: unknown): Promise<ActionResult<T>> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as ActionResult<T>;
    return typeof json?.ok === "boolean" ? json : fail("internal", "The server sent an unexpected answer. Try again.");
  } catch {
    return fail("dependency_failed", "Could not reach the server; check your connection and try again.");
  }
}

export const runAnatomy = (input: AnatomyInput) => post<AnatomyResponse>("/api/ai/explain-anatomy", input);
export const runInfographic = (input: InfographicInput) => post<InfographicResponse>("/api/ai/infographic", input);
