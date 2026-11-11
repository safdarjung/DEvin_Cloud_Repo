"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "../actions";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPassword, null);
  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          maxLength={72}
          autoComplete="new-password"
          aria-invalid={Boolean(fieldErrors?.password)}
          aria-describedby="password-hint"
          className="h-11 sm:h-10"
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          {fieldErrors?.password?.[0] ?? "At least 10 characters."}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          aria-invalid={Boolean(fieldErrors?.confirm)}
          className="h-11 sm:h-10"
        />
        {fieldErrors?.confirm && <p className="text-xs text-destructive">{fieldErrors.confirm[0]}</p>}
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error.message}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 sm:h-10">
        {pending ? "Saving…" : "Update password"}
      </Button>
    </form>
  );
}
