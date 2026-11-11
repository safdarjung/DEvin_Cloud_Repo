"use client";

import Link from "next/link";
import { Label } from "@/components/ui/label";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">
          Email
        </Label>
        <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@school.in" className="h-11 sm:h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">
            Password
          </Label>
          <Link href="/auth/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-11 sm:h-10"
        />
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error.message}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 sm:h-10">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
