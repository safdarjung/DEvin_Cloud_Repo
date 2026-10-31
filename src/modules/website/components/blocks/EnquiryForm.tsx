"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { EnquiryFormBlock } from "@/modules/website/blocks";
import { GRADE_CODES } from "@/modules/website/schemas";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

interface EnquiryResponse {
  ok: boolean;
  data?: { message: string; reference?: string; duplicate?: boolean };
  error?: { message: string };
}

// 06 §W3 — posts JSON to /api/public/enquiry (never a server action: this
// is anon/public, not an authenticated mutation, 04 §3). The hidden
// `website` field is the honeypot (C-83); a sighted human never sees or
// fills it.
export function EnquiryForm({ slug, block }: { slug: string; block: EnquiryFormBlock }) {
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setState({ status: "submitting" });

    const gradeCode = String(formData.get("gradeCode") ?? "");
    const email = String(formData.get("email") ?? "").trim();
    const message = String(formData.get("message") ?? "").trim();

    const body = {
      slug,
      childName: String(formData.get("childName") ?? ""),
      guardianName: String(formData.get("guardianName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      ...(gradeCode ? { gradeCode } : {}),
      ...(email ? { email } : {}),
      ...(message ? { message } : {}),
      website: String(formData.get("website") ?? ""),
    };

    try {
      const res = await fetch("/api/public/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await res.json()) as EnquiryResponse;

      if (result.ok && result.data) {
        // Same message for a fresh submission and a duplicate (06 §W3
        // "same message for duplicates") — the visitor never learns
        // whether their phone/child combination was already on file.
        const reference = result.data.reference;
        setState({
          status: "success",
          message: reference
            ? `Thank you, reference ${reference}; the admissions office will call you.`
            : result.data.message,
        });
        form.reset();
      } else {
        setState({ status: "error", message: result.error?.message ?? "Something went wrong. Please try again." });
      }
    } catch {
      setState({ status: "error", message: "Network error; please try again." });
    }
  }

  if (state.status === "success") {
    return (
      <p role="status" className="my-8 rounded-xl border bg-success/15 p-4 text-sm">
        {state.message}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="relative my-8 max-w-xl space-y-4 rounded-xl border bg-card p-5 sm:p-6">
      <h2 className="text-2xl font-semibold tracking-tight">{block.heading ?? "Admission enquiry"}</h2>
      <div className="space-y-1.5">
        <label htmlFor="enq-child" className="text-sm font-medium">Child&apos;s name</label>
        <Input id="enq-child" name="childName" required maxLength={120} autoComplete="off" className="h-11 text-base" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="enq-guardian" className="text-sm font-medium">Your name</label>
        <Input id="enq-guardian" name="guardianName" required maxLength={200} autoComplete="name" className="h-11 text-base" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="enq-phone" className="text-sm font-medium">Mobile number</label>
        <Input id="enq-phone" name="phone" placeholder="10-digit mobile number" required pattern="[6-9][0-9]{9}" type="tel" inputMode="numeric" autoComplete="tel-national" className="h-11 text-base" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="enq-grade" className="text-sm font-medium">Grade applying for (optional)</label>
        <select
        id="enq-grade"
        name="gradeCode"
        defaultValue=""
        className="h-11 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">Select grade</option>
        {GRADE_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="enq-email" className="text-sm font-medium">Email (optional)</label>
        <Input id="enq-email" name="email" type="email" autoComplete="email" className="h-11 text-base" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="enq-message" className="text-sm font-medium">Message (optional)</label>
        <Textarea id="enq-message" name="message" maxLength={2000} rows={3} className="text-base" />
      </div>
      {/* Honeypot (C-83): hidden from sighted users and keyboard tab order; left empty by humans, filled by bots that autofill every field. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute h-0 w-0 overflow-hidden opacity-0"
      />
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={state.status === "submitting"}>
        {state.status === "submitting" ? "Sending…" : block.ctaLabel ?? "Submit enquiry"}
      </Button>
    </form>
  );
}
