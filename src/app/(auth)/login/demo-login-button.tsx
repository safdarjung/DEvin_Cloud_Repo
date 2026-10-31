"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "cn";
import { demoLogin } from "./actions";

/**
 * One tap, no typing: signs in as a named demo account. The password is
 * never sent to or known by the browser (demoLogin reads it server-side).
 *
 * `icon` is a rendered element, not a component reference — a Server
 * Component can only pass plain, serializable values to a Client
 * Component, and a function (a component type) is not one of those.
 */
export function DemoLoginButton({
  email,
  name,
  role,
  blurb,
  icon,
  next,
}: {
  email: string;
  name: string;
  role: string;
  blurb: string;
  icon: ReactNode;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(demoLogin, null);

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next ?? ""} />
      <button
        type="submit"
        disabled={pending}
        className={cn(
          "group relative flex w-full items-start gap-3 rounded-xl p-3.5 text-left ring-1 ring-foreground/10",
          "bg-card shadow-xs transition-colors hover:bg-accent hover:ring-foreground/20",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-wait disabled:opacity-70",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-background [&_svg]:size-4">
          {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : icon}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium leading-tight">{name}</span>
          <span className="text-xs leading-snug text-muted-foreground">{role}</span>
          <span className="mt-1 text-xs leading-snug text-muted-foreground">{blurb}</span>
        </span>
      </button>
      {state && !state.ok && (
        <p role="alert" className="col-span-full -mt-1 text-xs text-destructive">
          {state.error.message}
        </p>
      )}
    </form>
  );
}
