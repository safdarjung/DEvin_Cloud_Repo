"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { demoLogin } from "@/app/(auth)/login/actions";

/** One role = one allow-listed demo account; demoLogin re-checks the email server-side. */
export function RoleCard({ email, role, note }: { email: string; role: string; note: string }) {
  const [state, formAction, pending] = useActionState(demoLogin, null);
  return (
    <li>
      <form action={formAction}>
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
        {state && !state.ok && (
          <p role="alert" className="pb-3 text-sm text-destructive">{state.error.message}</p>
        )}
      </form>
    </li>
  );
}
