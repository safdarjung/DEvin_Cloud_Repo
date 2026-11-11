"use client";
// Approval card for an AI task proposal. Built from TaskView alone: no Zod, no raw tool input.
import { motion, MotionConfig } from "motion/react";
import Link from "next/link";
import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";
import { approveProposal, discardProposal, markOpened, startProposal, type ApproveData } from "./api";
import {
  blockerText, buildInput, dedupeGroupErrors, firstBlockedPath, formatCountdown, initialEditing, initialValues, invalidFilled, isComplete, leaves, normalizeErrors, secondsLeft, summarizeErrors, validateAll,
  type ErrorMap, type Values,
} from "./fields";
import { rendererPlan, rosterShape } from "./renderers";
import { Roster } from "./Roster";
import { markReplaced, markResolved, useResolution } from "./store";
import { approveVerb, RISK_TEXT, summaryLines } from "./summary";
import { TaskFields, useFieldsPrefix, type FieldsCtx } from "./TaskFields";

export interface TaskCardHandle {
  /** Approve with the card's current values; true when approved. Used by the stack's "Approve all". */
  approve: () => Promise<boolean>;
}

export interface TaskCardProps {
  proposal: TaskProposalOutput;
  institutionSlug: string;
  onResolved?: (r: { status: "approved" | "discarded"; proposalId: string; resultHref?: string }) => void;
  onStart?: (next: TaskProposalOutput) => void;
  compact?: boolean;
  controlRef?: Ref<TaskCardHandle>;
}

type Phase = "idle" | "pending" | "approved" | "discarded" | "expired";
const NARROW = "(max-width: 639px)";
const LONG_FORM_LEAVES = 12;
const TICK_MS = 15_000;

const subscribeNarrow = (cb: () => void) => {
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);

export default function TaskCard({ proposal, institutionSlug, onResolved, onStart, compact, controlRef }: TaskCardProps) {
  const [adopted, setAdopted] = useState<TaskProposalOutput | null>(null);
  const active = adopted ?? proposal;
  const { view, proposalId } = active;
  const plan = rendererPlan(view.renderer);
  const roster = plan.type === "roster" ? rosterShape(view) : null;
  const prefix = useFieldsPrefix();
  const narrow = useNarrow();

  const [values, setValues] = useState<Values>(() => initialValues(view));
  const [editing, setEditing] = useState(() => plan.type === "form" || plan.type === "roster" ? initialEditing(view, initialValues(view)) : false);
  const [phase, setPhase] = useState<Phase>(() => (secondsLeft(view.expiresAt, Date.now()) <= 0 ? "expired" : "idle"));
  const [now, setNow] = useState(() => Date.now());
  const [errors, setErrors] = useState<ErrorMap>({});
  const [message, setMessage] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState<ApproveData | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoProposal, setUndoProposal] = useState<TaskProposalOutput | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const rosterAsked = useRef<string>("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const dep = useResolution(view.dependsOn);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  const left = secondsLeft(view.expiresAt, now);
  const expired = phase === "expired" || (phase === "idle" && left <= 0);
  const waiting = !!view.dependsOn && dep?.status !== "approved";
  const depDiscarded = dep?.status === "discarded";
  const humanApproved = view.risk === "human_approved";
  const busy = phase === "pending";
  const canAct = phase === "idle" && !expired;

  const liveErrors: ErrorMap = { ...invalidFilled(view, values), ...dedupeGroupErrors(view, errors) };
  const complete = isComplete(view, values);
  const blockers = complete ? "" : blockerText(view, values);
  /** Field edits; picking a section (and date) on an empty register loads the class roster. */
  function onValues(next: Values) {
    setValues(next);
    const section = next.classSectionId;
    const records = next.records;
    const wantsRoster = plan.type === "roster" && (view.action === "attendance.mark" || view.action === "attendance.markPeriod");
    if (!wantsRoster || typeof section !== "string" || !section || (Array.isArray(records) && records.length > 0)) return;
    const date = typeof next.date === "string" && next.date ? next.date : "today";
    const key = `${section}|${date}`;
    if (rosterAsked.current === key) return;
    rosterAsked.current = key;
    void loadRoster(section, date);
  }

  async function loadRoster(section: string, date: string) {
    setRosterLoading(true);
    setMessage(null);
    const res = await startProposal(institutionSlug, view.action, { classSectionId: section, date }, proposalId);
    setRosterLoading(false);
    if (!res.ok) {
      rosterAsked.current = "";
      if (/discarded|expired|already approved/i.test(res.error.message)) setPhase("expired");
      else setMessage(res.error.message);
      return;
    }
    markReplaced(proposalId, res.data.proposalId);
    setAdopted(res.data);
    setValues(initialValues(res.data.view));
    setErrors({});
  }

  const ctx: FieldsCtx = { view, values, errors: liveErrors, institutionSlug, idPrefix: prefix, disabled: busy || !canAct || rosterLoading, setValues: onValues };
  const longForm = leaves(view.fields, values).length > LONG_FORM_LEAVES;
  const useSheet = editing && (narrow || longForm);
  const inlineOpen = editing && !useSheet;
  /** Focus the first empty required field, else the first control. */
  const focusForm = (root: ParentNode | null) => {
    const first = firstBlockedPath(view, values);
    const sel = first ? `#${CSS.escape(`${prefix}${first.replace(/\//g, "-")}`)}` : null;
    const target = sel ? root?.querySelector<HTMLElement>(`${sel}, ${sel} input`) : null;
    (target ?? root?.querySelector<HTMLElement>("input, button[role=combobox], textarea, select"))?.focus();
  };
  useEffect(() => {
    // The Edit button unmounts when the form opens; keep keyboard focus inside the card.
    if (inlineOpen) focusForm(inlineRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineOpen]);

  async function approve(): Promise<boolean> {
    if (!canAct || waiting) return false;
    const clientErrors = validateAll(view, values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setMessage("Fix the highlighted fields, then approve again.");
      setEditing(true);
      requestAnimationFrame(() => alertRef.current?.focus());
      return false;
    }
    setPhase("pending");
    setErrors({});
    setMessage(null);
    const res = await approveProposal(institutionSlug, proposalId, buildInput(view, values));
    if (res.ok) {
      setResult(res.data);
      setPhase("approved");
      setEditing(false);
      markResolved(proposalId, { status: "approved", resultHref: res.data.resultHref });
      onResolved?.({ status: "approved", proposalId, resultHref: res.data.resultHref });
      requestAnimationFrame(() => headingRef.current?.focus());
      return true;
    }
    if (/expired|discarded|already approved/i.test(res.error.code + res.error.message)) {
      setPhase("expired");
      return false;
    }
    setPhase("idle");
    const mapped = normalizeErrors(res.error.fieldErrors);
    setErrors(mapped);
    setMessage(res.error.message);
    setEditing(true);
    requestAnimationFrame(() => alertRef.current?.focus({ preventScroll: false }));
    return false;
  }

  useImperativeHandle(controlRef, () => ({ approve }));

  async function discard() {
    setPhase("pending");
    await discardProposal(institutionSlug, proposalId);
    setPhase("discarded");
    setEditing(false);
    markResolved(proposalId, { status: "discarded" });
    onResolved?.({ status: "discarded", proposalId });
  }

  async function undo() {
    if (!result?.undo) return;
    setUndoing(true);
    const res = await startProposal(institutionSlug, result.undo.action, result.undo.values);
    setUndoing(false);
    if (!res.ok) {
      setMessage(res.error.message);
      return;
    }
    if (onStart) onStart(res.data);
    else setUndoProposal(res.data);
  }

  // ── states without a form ─────────────────────────────────────────────────
  if (plan.type === "link") {
    return (
      <CardShell compact={compact}>
        <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold">{view.title}</h3>
        <p className="text-sm text-muted-foreground">This one is done on its own page, where you enter the deciding details yourself.</p>
        <Link
          href={plan.href(institutionSlug)}
          onClick={() => void markOpened(institutionSlug, proposalId)}
          className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2"
        >
          Open this in {plan.page}
        </Link>
      </CardShell>
    );
  }

  if (phase === "discarded") {
    return (
      <CardShell compact>
        <p role="status" className="text-sm text-muted-foreground">Discarded: {view.title}</p>
      </CardShell>
    );
  }

  if (phase === "approved") {
    return (
      <>
        <CardShell compact={compact || collapsed}>
          <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{view.title}</h3>
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium text-success">{result?.resultLabel ?? "Done."}</span>
            {result?.resultHref && (
              <Link href={result.resultHref} className="inline-flex min-h-11 items-center underline underline-offset-2">
                Open
              </Link>
            )}
            {result?.undo && !collapsed && (
              <Button type="button" variant="outline" className="h-11" onClick={undo} disabled={undoing}>
                {undoing ? "Preparing…" : result.undo.label}
              </Button>
            )}
            {!collapsed && (
              <Button type="button" variant="ghost" className="h-11" onClick={() => setCollapsed(true)}>Hide details</Button>
            )}
          </div>
          {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
        </CardShell>
        {undoProposal && <TaskCard proposal={undoProposal} institutionSlug={institutionSlug} onResolved={onResolved} compact={compact} />}
      </>
    );
  }

  if (expired) {
    return (
      <CardShell compact={compact}>
        <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold">{view.title}</h3>
        <p role="status" className="text-sm text-muted-foreground">This expired; ask again.</p>
      </CardShell>
    );
  }

  // ── the card ───────────────────────────────────────────────────────────────
  const risk = RISK_TEXT[view.risk];
  const lines = summaryLines(view, values);
  const verb = approveVerb(view.label);
  const describedBy = [waiting ? `${prefix}-wait` : null, blockers ? `${prefix}-missing` : null].filter(Boolean).join(" ") || undefined;
  const missingLine = blockers ? <p id={`${prefix}-missing`} className="text-sm text-muted-foreground">{blockers}</p> : null;
  const approveBlocked = busy || waiting || !complete || (humanApproved && !checked);
  const summaryItems = summarizeErrors(view, values, errors);

  const form = (
    <form
      noValidate
      aria-label={`Edit: ${view.title}`}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) void approve();
      }}
    >
      {(summaryItems.length > 0 || message) && (
        <div ref={alertRef} role="alert" tabIndex={-1} className="rounded-md border border-destructive p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {message && <p className="font-medium text-destructive">{message}</p>}
          <ErrorList items={summaryItems} prefix={prefix} />
        </div>
      )}
      {rosterLoading && <p role="status" className="text-sm text-muted-foreground">Loading the class list…</p>}
      {roster ? (
        <>
          <TaskFields fields={view.fields.filter((f) => f.path !== roster.array.path)} ctx={ctx} />
          <Roster view={view} shape={roster} values={values} errors={errors} idPrefix={prefix} disabled={ctx.disabled} setValues={setValues} />
        </>
      ) : (
        <TaskFields fields={view.fields} ctx={ctx} />
      )}
      {actions()}
    </form>
  );

  function actions() {
    return (
      <div className="space-y-2">
        {missingLine}
        {humanApproved && (
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy} />
            <span>I have checked this. {risk.note}</span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-11" disabled={approveBlocked} aria-describedby={describedBy}>
            {busy ? "Working…" : verb}
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={discard} disabled={busy}>Discard</Button>
        </div>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <CardShell compact={compact}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">{view.title}</h3>
          <Badge variant={view.risk === "human_approved" ? "warning" : view.risk === "low_risk_reversible" ? "success" : "info"}>
            Risk: {risk.word}
          </Badge>
        </div>
        {view.provenance && <p className="text-xs text-muted-foreground">{view.provenance}</p>}
        <dl className="space-y-0.5 text-sm">
          {lines.map((l) => (
            <div key={l.label} className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{l.label}:</dt>
              <dd className={l.needsYou ? "font-medium text-warning" : ""}>{l.text}</dd>
            </div>
          ))}
        </dl>
        {humanApproved && <p className="text-sm">{risk.note}</p>}
        <p className="text-xs text-muted-foreground">{formatCountdown(left)}</p>
        {waiting && (
          <p id={`${prefix}-wait`} className="text-sm font-medium text-muted-foreground">
            {depDiscarded ? "The previous step was discarded, so this cannot run." : "Waiting for the previous step."}
          </p>
        )}
        {message && !editing && <p role="alert" className="text-sm text-destructive">{message}</p>}

        {!editing && (
          <div className="space-y-2">
            {humanApproved && (
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy} />
                <span>I have checked this.</span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="h-11" onClick={() => void approve()} disabled={approveBlocked} aria-describedby={describedBy}>
                {busy ? "Working…" : verb}
              </Button>
              <Button type="button" variant="outline" className="h-11" onClick={() => setEditing(true)} disabled={busy}>Edit</Button>
              <Button type="button" variant="ghost" className="h-11" onClick={discard} disabled={busy}>Discard</Button>
            </div>
            {missingLine}
          </div>
        )}

        {editing && !useSheet && (
          <motion.div ref={inlineRef} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 400, damping: 34 }} className="space-y-3 border-t pt-3">
            {form}
            <Button type="button" variant="ghost" className="h-11" onClick={() => { setEditing(false); requestAnimationFrame(() => headingRef.current?.focus()); }}>Close editor</Button>
          </motion.div>
        )}
      </CardShell>
      <Sheet open={useSheet} onOpenChange={(o) => !o && setEditing(false)}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] overflow-y-auto p-4"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => focusForm(document.getElementById(`${prefix}-sheet`)));
          }}
          id={`${prefix}-sheet`}
        >
          <SheetHeader className="p-0">
            <SheetTitle>{view.title}</SheetTitle>
            <SheetDescription>Check each value, then {verb.toLowerCase()}.</SheetDescription>
          </SheetHeader>
          {form}
        </SheetContent>
      </Sheet>
    </MotionConfig>
  );
}

/** Scroll to and focus a field by concrete path (clears a fixed footer via scroll-margin). */
function jumpToField(prefix: string, path: string) {
  const el = document.getElementById(`${prefix}${path.replace(/\//g, "-")}`);
  const target = el?.matches("input, button, textarea, select") ? el : el?.querySelector<HTMLElement>("input, button, textarea, select");
  target?.scrollIntoView({ block: "center" });
  target?.focus();
}

function ErrorList({ items, prefix }: { items: { path: string; label: string; message: string }[]; prefix: string }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 list-disc pl-5">
      {items.map((it, i) => (
        <li key={`${it.path}-${i}`}>
          <a
            className="underline"
            href={`#${prefix}${it.path.replace(/\//g, "-")}`}
            onClick={(e) => {
              e.preventDefault();
              jumpToField(prefix, it.path);
            }}
          >
            {it.label}
          </a>
          : {it.message}
        </li>
      ))}
    </ul>
  );
}

function CardShell({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className={`min-w-0 scroll-mb-[var(--task-card-scroll-margin,6rem)] space-y-2 rounded-lg border bg-card text-card-foreground [&_*]:scroll-mb-[var(--task-card-scroll-margin,6rem)] ${compact ? "p-2 text-sm" : "p-3 pb-4"}`}
    >
      {children}
    </motion.section>
  );
}
