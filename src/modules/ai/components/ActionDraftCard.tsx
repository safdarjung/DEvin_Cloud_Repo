"use client";

// ai-roles P2 — renders a draft-tool output as a review-and-save card.
// Two tool shapes feed this: the kernel's `draft_<action>` tools (P1,
// `{ kind: "action_draft", action, input, summary }`) and the existing
// `createTask` tool (`{ kind: "task_draft", action, input, note }`,
// src/modules/ai/assistant/tools.ts). `parseDraftToolOutput` normalizes
// both into one shape; an invalid-input tool call returns a plain string
// instead (Zod validation failed server-side) and is shown as text, never
// a card. Saving goes through the existing action dispatcher
// (`src/app/api/v1/actions/[name]/route.ts` → `dispatchCall`) — this
// component never calls an action directly or writes anything itself.
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseTaskProposalOutput } from "@/modules/ai/components/task-card/parse";
import TaskCard from "@/modules/ai/components/task-card/TaskCard";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";

export interface ActionDraftFields {
  action: string;
  input: Record<string, unknown>;
  summary: string;
  /** Set for `propose_task` outputs: the card renders from this and ignores action/input. */
  proposal?: TaskProposalOutput;
}

/** A tool-call chat part is a draft card candidate iff its type is this shape. */
export function isDraftToolPartType(type: string): boolean {
  return type.startsWith("tool-draft_") || type === "tool-createTask" || type === "tool-propose_task";
}

/**
 * Normalizes the two draft tool-output shapes into one, or passes through
 * the plain-string validation-error case. `null` means "not a draft output
 * this card knows how to render" — the caller falls back to its default
 * tool-status line.
 */
export function parseDraftToolOutput(output: unknown): ActionDraftFields | { error: string } | null {
  if (typeof output === "string") return { error: output };
  if (typeof output !== "object" || output === null) return null;

  const proposal = parseTaskProposalOutput(output);
  if (proposal) return { action: proposal.view.action, input: {}, summary: proposal.view.title, proposal };

  const o = output as Record<string, unknown>;
  if (typeof o.action !== "string" || typeof o.input !== "object" || o.input === null) return null;
  const input = o.input as Record<string, unknown>;

  if (o.kind === "action_draft" && typeof o.summary === "string") {
    return { action: o.action, input, summary: o.summary };
  }
  if (o.kind === "task_draft") {
    const note = typeof o.note === "string" ? o.note : "Review this draft before saving.";
    return { action: o.action, input, summary: note };
  }
  return null;
}

/** "curriculumUnitId" / "curriculum_unit_id" -> "Curriculum unit id" */
export function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Textarea once a string field is long or multi-line; a plain Input otherwise. */
export function isLongText(value: string): boolean {
  return value.length > 80 || value.includes("\n");
}

/** Read-only rendering for a non-string field. */
export function formatReadOnlyValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type SaveStatus = "editing" | "saving" | "saved" | "discarded";

export interface ActionDraftCardProps {
  institutionSlug: string;
  action: string;
  input: Record<string, unknown>;
  summary: string;
  proposal?: TaskProposalOutput;
}

export function ActionDraftCard({ proposal, ...rest }: ActionDraftCardProps) {
  if (proposal) return <TaskCard proposal={proposal} institutionSlug={rest.institutionSlug} />;
  return <LegacyDraftCard {...rest} />;
}

function LegacyDraftCard({ institutionSlug, action, input, summary }: Omit<ActionDraftCardProps, "proposal">) {
  const idPrefix = useId();
  const [fields, setFields] = useState<Record<string, unknown>>(input);
  const [status, setStatus] = useState<SaveStatus>("editing");
  const [error, setError] = useState<string | null>(null);

  const locked = status !== "editing";

  async function handleSave() {
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch(`/api/v1/actions/${encodeURIComponent(action)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ institution: institutionSlug, input: fields }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!body.ok) {
        setError(body.error?.message ?? "Could not save.");
        setStatus("editing");
        return;
      }
      setStatus("saved");
    } catch {
      setError("Could not reach the server; check your connection and try again.");
      setStatus("editing");
    }
  }

  if (status === "discarded") {
    return (
      <Card>
        <CardContent>
          <p role="status" className="text-sm text-muted-foreground">
            Discarded.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>{summary}</span>
          {status !== "saved" && <Badge variant="outline">Review and save</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {Object.entries(fields).map(([key, value]) => {
          const fieldId = `${idPrefix}-${key}`;
          const editable = typeof value === "string";
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={fieldId}>{humanizeFieldKey(key)}</Label>
              {editable ? (
                isLongText(value as string) ? (
                  <Textarea
                    id={fieldId}
                    value={value as string}
                    onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                    rows={4}
                    disabled={locked}
                  />
                ) : (
                  <Input
                    id={fieldId}
                    value={value as string}
                    onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                    disabled={locked}
                  />
                )
              ) : (
                <p id={fieldId} className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {formatReadOnlyValue(value)}
                </p>
              )}
            </div>
          );
        })}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {status === "saved" ? (
          <p role="status" className="text-sm text-success">
            Saved.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setStatus("discarded")} disabled={status === "saving"}>
              Discard
            </Button>
            <Button type="button" onClick={handleSave} disabled={status === "saving"}>
              {status === "saving" ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
