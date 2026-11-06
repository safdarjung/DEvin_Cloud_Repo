"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "cn";

type Kind = "demo" | "contact";
type FieldErrors = Record<string, string>;
type State =
  | { s: "idle" }
  | { s: "sending" }
  | { s: "success"; message: string }
  | { s: "error"; message: string; fields: FieldErrors };

const ROLES = ["Principal", "Administrator", "Teacher", "Parent", "Trustee or management", "Other"];
const FIELD = "min-h-11 w-full rounded-md border border-(color:--mk-line) bg-(color:--mk-bg) px-3 text-base text-(color:--mk-fg) placeholder:text-(color:--mk-muted)/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(color:--mk-accent) aria-[invalid=true]:border-red-500";

function FieldError({ k, msg }: { k: string; msg?: string }) {
  return msg ? (
    <p id={`lf-${k}-e`} className="mt-1 text-sm text-red-600 dark:text-red-400">
      {msg}
    </p>
  ) : null;
}

function normaliseFields(raw: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const msg = Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" ") : typeof v === "string" ? v : "";
      if (msg) out[k] = msg;
    }
  }
  return out;
}

export function LeadForm({ defaultKind = "demo" }: { defaultKind?: Kind }) {
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [state, setState] = useState<State>({ s: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const [lastBody, setLastBody] = useState<string | null>(null);

  async function send(body: string) {
    setState({ s: "sending" });
    try {
      const res = await fetch("/api/public/lead", { method: "POST", headers: { "content-type": "application/json" }, body });
      const json: unknown = await res.json().catch(() => null);
      const j = json as { ok?: boolean; data?: { message?: string }; error?: { message?: string; fieldErrors?: unknown } } | null;
      if (res.ok && j?.ok === true) {
        setState({ s: "success", message: j.data?.message ?? "Thank you. We have received your request." });
        formRef.current?.reset();
        return;
      }
      setState({
        s: "error",
        message: j?.error?.message ?? "We could not send your request. Please try again.",
        fields: normaliseFields(j?.error?.fieldErrors),
      });
    } catch {
      setState({ s: "error", message: "Network problem. Your request was not sent. Please try again.", fields: {} });
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const body = JSON.stringify({
      name: get("name"),
      email: get("email"),
      phone: get("phone"),
      institution: get("institution"),
      role: get("role"),
      message: get("message"),
      kind,
      website: get("website"),
    });
    setLastBody(body);
    void send(body);
  }

  if (state.s === "success") {
    return (
      <div role="status" className="rounded-lg border border-(color:--mk-accent) bg-(color:--mk-accent-soft) p-6">
        <h2 className="text-lg font-semibold">Request received</h2>
        <p className="mt-2 text-(color:--mk-fg)">{state.message}</p>
        <button type="button" onClick={() => setState({ s: "idle" })} className="mt-4 min-h-11 text-sm font-semibold underline underline-offset-4">
          Send another
        </button>
      </div>
    );
  }

  const fields = state.s === "error" ? state.fields : {};
  const err = (k: string) => fields[k];
  const common = (k: string) => ({
    id: `lf-${k}`,
    name: k,
    "aria-invalid": err(k) ? true : undefined,
    "aria-describedby": err(k) ? `lf-${k}-e` : undefined,
    className: FIELD,
  });
  const label = "mb-1.5 block text-sm font-medium";

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5" aria-busy={state.s === "sending"}>
      <fieldset>
        <legend className={label}>I would like to</legend>
        <div className="flex flex-wrap gap-2">
          {([["demo", "Book a demo"], ["contact", "Ask a question"]] as const).map(([v, l]) => (
            <label
              key={v}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center rounded-md border px-4 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(color:--mk-accent)",
                kind === v ? "border-(color:--mk-accent) bg-(color:--mk-accent-soft)" : "border-(color:--mk-line)",
              )}
            >
              <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="sr-only" />
              {l}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="lf-name" className={label}>Name</label>
          <input {...common("name")} autoComplete="name" required />
          <FieldError k="name" msg={err("name")} />
        </div>
        <div>
          <label htmlFor="lf-email" className={label}>Work email</label>
          <input {...common("email")} type="email" autoComplete="email" required />
          <FieldError k="email" msg={err("email")} />
        </div>
        <div>
          <label htmlFor="lf-phone" className={label}>Phone <span className="font-normal text-(color:--mk-muted)">(optional)</span></label>
          <input {...common("phone")} type="tel" autoComplete="tel" />
          <FieldError k="phone" msg={err("phone")} />
        </div>
        <div>
          <label htmlFor="lf-institution" className={label}>Institution</label>
          <input {...common("institution")} autoComplete="organization" />
          <FieldError k="institution" msg={err("institution")} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="lf-role" className={label}>Your role</label>
          <select {...common("role")} defaultValue="">
            <option value="">Select a role</option>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <FieldError k="role" msg={err("role")} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="lf-message" className={label}>Message</label>
          <textarea {...common("message")} rows={5} className={cn(FIELD, "py-2")} />
          <FieldError k="message" msg={err("message")} />
        </div>
      </div>

      {/* Honeypot: real users never see or reach this field. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="lf-website">Website</label>
        <input id="lf-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {state.s === "error" && (
        <div role="alert" className="rounded-md border border-red-500/60 p-4 text-sm">
          <p>{state.message}</p>
          {lastBody && (
            <button type="button" onClick={() => void send(lastBody)} className="mt-3 min-h-11 font-semibold underline underline-offset-4">
              Retry
            </button>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={state.s === "sending"}
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-(color:--mk-accent) px-6 text-sm font-semibold text-(color:--mk-accent-fg) hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--mk-accent) disabled:opacity-60"
      >
        {state.s === "sending" && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
        {state.s === "sending" ? "Sending" : kind === "demo" ? "Request a demo" : "Send message"}
      </button>
      <p className="text-xs text-(color:--mk-muted)">We use these details only to reply to your request. See the draft privacy notice.</p>
    </form>
  );
}
