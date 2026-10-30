"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { demoLogin } from "./actions";

/**
 * One tap, no typing: signs in as a named demo account. The password is
 * never sent to or known by the browser (demoLogin reads it server-side).
 */
export function DemoLoginButton({
  email,
  label,
  next,
}: {
  email: string;
  label: string;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(demoLogin, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Button type="submit" variant="outline" disabled={pending} className="w-full justify-between font-normal">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{pending ? "Signing in…" : email}</span>
      </Button>
      {state && !state.ok && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {state.error.message}
        </p>
      )}
    </form>
  );
}
