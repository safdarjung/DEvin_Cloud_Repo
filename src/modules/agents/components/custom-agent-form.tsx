"use client";

// Create / edit a school's own agent (0134). The base picker decides which
// tools and actions can be ticked. This is convenience only: the action's
// Zod schema re-checks the subset, and every run re-narrows it (scopedSpec).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACTION_RISK, AGENT_CATALOG, AGENT_SLUGS, MAX_CUSTOM_INSTRUCTIONS, type AgentSlug } from "@/modules/agents/catalog";
import { createCustomAgent, updateCustomAgent } from "@/modules/agents/actions";
import { APPROVAL_TAG } from "./helpers";

const SELECT = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9";
const EXAMPLE_SLOTS = 3;

export interface CustomAgentValues {
  id?: string;
  name: string;
  summary: string;
  instructions: string;
  examples: string[];
  baseSlug: AgentSlug;
  tools: string[];
  actions: string[];
}

// New agents start with every read tool of the base and no actions: the
// author opts in to anything that proposes a change.
function blank(baseSlug: AgentSlug): CustomAgentValues {
  return { name: "", summary: "", instructions: "", examples: [], baseSlug, tools: Object.keys(AGENT_CATALOG[baseSlug].tools), actions: [] };
}

function toggle(list: string[], name: string): string[] {
  return list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
}

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-destructive">
      {errors.join(" ")}
    </p>
  );
}

export function CustomAgentDialog({
  institutionSlug,
  initial,
  open,
  onOpenChange,
}: {
  institutionSlug: string;
  initial?: CustomAgentValues;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState<CustomAgentValues>(() => initial ?? blank(AGENT_SLUGS[0]));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const [error, setError] = useState<string | null>(null);
  const isEdit = Boolean(initial?.id);
  const base = AGENT_CATALOG[v.baseSlug];
  const examples = Array.from({ length: EXAMPLE_SLOTS }, (_, i) => v.examples[i] ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      setError(null);
      setFieldErrors(undefined);
      const payload = {
        name: v.name,
        summary: v.summary,
        instructions: v.instructions,
        examples: v.examples.map((x) => x.trim()).filter(Boolean),
        baseSlug: v.baseSlug,
        tools: v.tools,
        actions: v.actions,
      };
      const res = initial?.id
        ? await updateCustomAgent(institutionSlug, { id: initial.id, ...payload })
        : await createCustomAgent(institutionSlug, payload);
      if (res.ok) {
        toast.success(isEdit ? `${v.name} updated` : `${v.name} created`);
        onOpenChange(false);
        if (!isEdit) setV(blank(AGENT_SLUGS[0]));
        router.refresh();
      } else {
        setFieldErrors(res.error.fieldErrors);
        setError(res.error.message);
        toast.error(res.error.message);
      }
    });
  }

  const err = (field: string) => fieldErrors?.[field];
  const described = (field: string) => (err(field) ? `ca-${field}-err` : undefined);

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${initial?.name}` : "Create agent"}</DialogTitle>
          <DialogDescription>
            Your agent is built on one of the school agents. It can only use the tools and suggestions you tick here, and risky
            suggestions still wait for approval.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div>
            <Label htmlFor="ca-base">Based on</Label>
            <select
              id="ca-base"
              className={SELECT}
              value={v.baseSlug}
              disabled={isEdit || pending}
              onChange={(e) => setV({ ...blank(e.target.value as AgentSlug), name: v.name, summary: v.summary, instructions: v.instructions, examples: v.examples })}
            >
              {AGENT_SLUGS.map((slug) => (
                <option key={slug} value={slug}>
                  {AGENT_CATALOG[slug].name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{isEdit ? "The base agent cannot change after creation." : base.summary}</p>
          </div>

          <div>
            <Label htmlFor="ca-name">Name</Label>
            <Input
              id="ca-name"
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
              maxLength={60}
              required
              aria-invalid={!!err("name")}
              aria-describedby={described("name")}
            />
            <FieldError id="ca-name-err" errors={err("name")} />
          </div>

          <div>
            <Label htmlFor="ca-summary">One-line summary</Label>
            <Input
              id="ca-summary"
              value={v.summary}
              onChange={(e) => setV({ ...v, summary: e.target.value })}
              maxLength={120}
              required
              aria-invalid={!!err("summary")}
              aria-describedby={described("summary")}
            />
            <FieldError id="ca-summary-err" errors={err("summary")} />
          </div>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Looks at</legend>
            {Object.entries(base.tools).map(([name, description]) => (
              <label key={name} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={v.tools.includes(name)} disabled={pending} onChange={() => setV({ ...v, tools: toggle(v.tools, name) })} />
                {description}
              </label>
            ))}
            <FieldError id="ca-tools-err" errors={err("tools")} />
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Can suggest</legend>
            {Object.keys(base.actions).length === 0 && (
              <p className="text-sm text-muted-foreground">This base agent only reads records; people decide.</p>
            )}
            {Object.entries(base.actions).map(([name, description]) => (
              <label key={name} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={v.actions.includes(name)} disabled={pending} onChange={() => setV({ ...v, actions: toggle(v.actions, name) })} />
                <span>
                  {description} <span className="text-muted-foreground">({APPROVAL_TAG[ACTION_RISK[name]]})</span>
                </span>
              </label>
            ))}
            <FieldError id="ca-actions-err" errors={err("actions")} />
          </fieldset>

          <div>
            <Label htmlFor="ca-instructions">Instructions</Label>
            <Textarea
              id="ca-instructions"
              value={v.instructions}
              onChange={(e) => setV({ ...v, instructions: e.target.value })}
              rows={5}
              maxLength={MAX_CUSTOM_INSTRUCTIONS}
              required
              aria-invalid={!!err("instructions")}
              aria-describedby={`ca-instructions-count${err("instructions") ? " ca-instructions-err" : ""}`}
            />
            <p id="ca-instructions-count" className="mt-1 text-xs text-muted-foreground">
              {v.instructions.length}/{MAX_CUSTOM_INSTRUCTIONS} characters. Instructions guide the answer; they cannot add tools or skip approval.
            </p>
            <FieldError id="ca-instructions-err" errors={err("instructions")} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Example prompts (optional)</legend>
            {examples.map((value, i) => (
              <Input
                key={i}
                aria-label={`Example prompt ${i + 1}`}
                value={value}
                maxLength={90}
                disabled={pending}
                onChange={(e) => setV({ ...v, examples: examples.map((x, j) => (j === i ? e.target.value : x)) })}
              />
            ))}
            <FieldError id="ca-examples-err" errors={err("examples")} />
          </fieldset>

          {error && !fieldErrors && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save changes" : "Create agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateAgentButton({ institutionSlug }: { institutionSlug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Create agent
      </Button>
      <CustomAgentDialog institutionSlug={institutionSlug} open={open} onOpenChange={setOpen} />
    </>
  );
}
