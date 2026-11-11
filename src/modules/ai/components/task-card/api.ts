// Client calls to the registered actions and queries; always the envelope, never a throw.
import type { EntityOption, TaskProposalOutput, EntityType } from "@/modules/ai/tasks/types";

export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } };

const NETWORK: Envelope<never> = { ok: false, error: { code: "internal", message: "Could not reach the server; check your connection and try again." } };

async function parse<T>(res: Response): Promise<Envelope<T>> {
  try {
    return (await res.json()) as Envelope<T>;
  } catch {
    return NETWORK;
  }
}

export async function callAction<T>(institution: string, name: string, input: unknown): Promise<Envelope<T>> {
  try {
    const res = await fetch(`/api/v1/actions/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ institution, input }),
    });
    return await parse<T>(res);
  } catch {
    return NETWORK;
  }
}

export async function callQuery<T>(institution: string, name: string, input: unknown, signal?: AbortSignal): Promise<Envelope<T>> {
  try {
    const url = `/api/v1/query/${encodeURIComponent(name)}?institution=${encodeURIComponent(institution)}&input=${encodeURIComponent(JSON.stringify(input ?? {}))}`;
    return await parse<T>(await fetch(url, { signal }));
  } catch {
    return NETWORK;
  }
}

export interface ApproveData {
  status: "approved";
  resultHref?: string;
  resultLabel?: string;
  undo?: { action: string; label: string; values?: Record<string, unknown> };
}

export const approveProposal = (institution: string, proposalId: string, values: unknown) =>
  callAction<ApproveData>(institution, "ai.proposal.approve", { proposalId, values });
export const discardProposal = (institution: string, proposalId: string) =>
  callAction<unknown>(institution, "ai.proposal.discard", { proposalId });
export const startProposal = (institution: string, action: string, values?: unknown, replaces?: string) =>
  callAction<TaskProposalOutput>(institution, "ai.proposal.start", { action, ...(values !== undefined ? { values } : {}), ...(replaces ? { replaces } : {}) });
export const markOpened = (institution: string, proposalId: string) =>
  callAction<unknown>(institution, "ai.proposal.opened", { proposalId });
export const fetchEntityOptions = (
  institution: string,
  input: { action: string; path: string; entity: EntityType; search?: string; scope?: Record<string, string> },
  signal?: AbortSignal,
) => callQuery<EntityOption[]>(institution, "ai.taskEntityOptions", input, signal);
