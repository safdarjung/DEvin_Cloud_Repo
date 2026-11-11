"use client";

// Concession controls. Hiding them is UX only: every action re-checks its
// permission, and public.decide_concession_award re-checks owner/principal,
// approver ≠ requester and pending.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describeActionError } from "@/lib/action-error";
import { decideConcessionAward, requestConcessionAward, saveConcessionRule, setConcessionRuleActive } from "@/modules/scholarships/actions";
import { ConcessionAwardRequestSchema, ConcessionRuleSaveSchema } from "@/modules/scholarships/schemas";
import { concessionValue } from "./value";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

type RuleOption = { id: string; name: string; percent: number | null; amountPaise: number | null };

export function RequestAwardForm({ institutionSlug, studentId, studentName, rules }: { institutionSlug: string; studentId: string; studentName: string; rules: RuleOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ruleId, setRuleId] = useState(rules[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = ConcessionAwardRequestSchema.safeParse({ studentId, ruleId, reason });
    if (!parsed.success) return setError("Pick a rule and give a reason of at least 5 characters.");
    setError(null);
    start(async () => {
      const res = await requestConcessionAward(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success(`Concession requested for ${studentName}. An owner or principal decides it.`);
        setReason("");
        router.push(`?tab=awards&status=pending`);
      } else {
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div>
        <Label htmlFor="award-rule">Rule</Label>
        <select id="award-rule" className={SELECT_CLASS} value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({concessionValue(r.percent, r.amountPaise)})
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="award-reason">Reason</Label>
        <Textarea id="award-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(error)} placeholder="Why this student qualifies" />
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div>
        <Button type="submit" disabled={pending || rules.length === 0}>
          {pending ? "Requesting…" : `Request for ${studentName}`}
        </Button>
      </div>
    </form>
  );
}

/** Owner/principal only, and never on an award the caller requested (the page hides it; the server refuses it). */
export function DecideAwardButton({ institutionSlug, awardId, studentName, value }: { institutionSlug: string; awardId: string; studentName: string; value: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function decide(decision: "approved" | "rejected") {
    start(async () => {
      const res = await decideConcessionAward(institutionSlug, { awardId, decision, ...(note.trim() ? { note: note.trim() } : {}) });
      if (res.ok) {
        toast.success(decision === "approved" ? "Concession approved" : "Concession rejected");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Decide
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {value} concession for {studentName}
            </DialogTitle>
            <DialogDescription>A decision is final. It is recorded only and does not change any invoice.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor={`note-${awardId}`}>Note (optional)</Label>
            <Textarea id={`note-${awardId}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => decide("rejected")}>
              Reject
            </Button>
            <Button type="button" disabled={pending} onClick={() => decide("approved")}>
              {pending ? "Saving…" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type RuleDraft = { id?: string; name: string; criteria: string | null; percent: number | null; amountPaise: number | null };

function RuleFields({ institutionSlug, rule, onSaved }: { institutionSlug: string; rule?: RuleDraft; onSaved: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(rule?.name ?? "");
  const [criteria, setCriteria] = useState(rule?.criteria ?? "");
  const [mode, setMode] = useState<"percent" | "amount">(rule?.amountPaise != null ? "amount" : "percent");
  const [value, setValue] = useState(rule ? String(rule.percent ?? (rule.amountPaise ?? 0) / 100) : "");
  const [error, setError] = useState<string | null>(null);
  const prefix = rule?.id ?? "new";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value);
    const parsed = ConcessionRuleSaveSchema.safeParse({
      ...(rule?.id ? { id: rule.id } : {}),
      name,
      ...(criteria.trim() ? { criteria } : {}),
      ...(mode === "percent" ? { percent: n } : { amountPaise: Math.round(n * 100) }),
    });
    if (!parsed.success) return setError(mode === "percent" ? "Give a name and a percent above 0, up to 100." : "Give a name and an amount above ₹0.");
    setError(null);
    start(async () => {
      const res = await saveConcessionRule(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success(rule?.id ? "Rule updated. Existing awards keep their value." : "Rule created");
        if (!rule) {
          setName("");
          setCriteria("");
          setValue("");
        }
        onSaved();
        router.refresh();
      } else {
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div>
        <Label htmlFor={`rule-name-${prefix}`}>Name</Label>
        <Input id={`rule-name-${prefix}`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Sibling concession" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`rule-mode-${prefix}`}>Type</Label>
          <select id={`rule-mode-${prefix}`} className={SELECT_CLASS} value={mode} onChange={(e) => setMode(e.target.value as "percent" | "amount")}>
            <option value="percent">Percent of fee</option>
            <option value="amount">Fixed amount (₹)</option>
          </select>
        </div>
        <div>
          <Label htmlFor={`rule-value-${prefix}`}>{mode === "percent" ? "Percent" : "Amount (₹)"}</Label>
          <Input id={`rule-value-${prefix}`} type="number" inputMode="decimal" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={Boolean(error)} />
        </div>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`rule-criteria-${prefix}`}>Who qualifies (optional)</Label>
        <Textarea id={`rule-criteria-${prefix}`} value={criteria} maxLength={500} onChange={(e) => setCriteria(e.target.value)} />
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : rule?.id ? "Save rule" : "Create rule"}
        </Button>
      </div>
    </form>
  );
}

export function NewRuleForm({ institutionSlug }: { institutionSlug: string }) {
  return <RuleFields institutionSlug={institutionSlug} onSaved={() => undefined} />;
}

export function EditRuleButton({ institutionSlug, rule }: { institutionSlug: string; rule: RuleDraft & { id: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {rule.name}</DialogTitle>
            <DialogDescription>Applies to new requests only. Awards already requested keep the value they were given.</DialogDescription>
          </DialogHeader>
          <RuleFields institutionSlug={institutionSlug} rule={rule} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RuleActiveButton({ institutionSlug, id, isActive }: { institutionSlug: string; id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setConcessionRuleActive(institutionSlug, { id, isActive: !isActive });
          if (res.ok) {
            toast.success(isActive ? "Rule deactivated" : "Rule reactivated");
            router.refresh();
          } else {
            toast.error(describeActionError(res.error));
          }
        })
      }
    >
      {isActive ? "Deactivate" : "Reactivate"}
    </Button>
  );
}
