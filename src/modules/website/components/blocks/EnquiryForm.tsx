"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
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
      <p role="status" className="rounded-lg border p-4 text-sm">
        {state.message}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-md space-y-3 py-8">
      <h2 className="text-2xl font-semibold">{block.heading ?? "Admission enquiry"}</h2>
      <Input name="childName" placeholder="Child's name" required maxLength={120} />
      <Input name="guardianName" placeholder="Your name" required maxLength={200} />
      <Input name="phone" placeholder="10-digit mobile number" required pattern="[6-9][0-9]{9}" />
      <select
        name="gradeCode"
        defaultValue=""
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none"
      >
        <option value="">Grade applying for (optional)</option>
        {GRADE_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <Input name="email" type="email" placeholder="Email (optional)" />
      <textarea
        name="message"
        placeholder="Message (optional)"
        maxLength={2000}
        rows={3}
        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none"
      />
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
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={state.status === "submitting"}>
        {state.status === "submitting" ? "Sending…" : block.ctaLabel ?? "Submit enquiry"}
      </Button>
    </form>
  );
}
