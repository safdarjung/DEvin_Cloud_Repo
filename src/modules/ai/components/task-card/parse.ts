// Reads a tool part for the approval card. SECURITY: only `output` is read, never `input`
// (the raw tool-call input is model text and may hold values the server stripped).
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";

/** Narrow check of a tool OUTPUT; null when it is not a task proposal. */
export function parseTaskProposalOutput(output: unknown): TaskProposalOutput | null {
  if (typeof output !== "object" || output === null) return null;
  const o = output as Record<string, unknown>;
  if (o.kind !== "task_proposal" || typeof o.proposalId !== "string") return null;
  const v = o.view as Record<string, unknown> | null | undefined;
  if (!v || typeof v !== "object") return null;
  if (typeof v.action !== "string" || typeof v.title !== "string" || !Array.isArray(v.fields)) return null;
  if (typeof v.expiresAt !== "string" || typeof v.risk !== "string") return null;
  return output as TaskProposalOutput;
}

/** Same, from a whole chat tool part: touches `.output` and nothing else. */
export function taskProposalFromPart(part: { output?: unknown }): TaskProposalOutput | null {
  return parseTaskProposalOutput(part.output);
}
