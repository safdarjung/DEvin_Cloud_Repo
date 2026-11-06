"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

/** One role = one allow-listed demo account; /api/public/demo-login re-checks the email server-side. */
export function RoleCard({ email, role, note }: { email: string; role: string; note: string }) {
  const [pending, setPending] = useState(false);
  return (
    <li>
      <form method="post" action="/api/public/demo-login" onSubmit={() => setPending(true)}>
        <input type="hidden" name="email" value={email} />
        <button
          type="submit"
          disabled={pending}
          className="group flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-(color:--mk-accent) disabled:cursor-wait disabled:opacity-70"
        >
          <span>
            <span className="block font-semibold">{role}</span>
            <span className="block text-sm text-(color:--mk-muted)">{note}</span>
          </span>
          {pending ? (
            <Loader2 className="size-4 animate-spin text-(color:--mk-accent) motion-reduce:animate-none" aria-hidden />
          ) : (
            <ArrowRight className="size-4 text-(color:--mk-accent) transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
          )}
        </button>
      </form>
    </li>
  );
}
