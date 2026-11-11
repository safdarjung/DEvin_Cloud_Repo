"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "../actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, null);

  if (state?.ok) {
    return (
      <p role="status" className="rounded-lg bg-muted px-3 py-2.5 text-sm">
        If an account exists for that email, we have sent a link to reset your password. It expires in one hour.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@school.in" className="h-11 sm:h-10" />
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error.message}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 sm:h-10">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
