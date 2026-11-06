"use client";

import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * One tap, no typing: signs in as a named demo account. The password is
 * never sent to or known by the browser (/api/public/demo-login signs in
 * passwordless server-side; a full-page POST, see that route for why). No
 * React handlers on the form, so a click during hydration still submits.
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
  return (
    <form method="post" action="/api/public/demo-login" className="contents">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next ?? ""} />
      <button
        type="submit"
        title={blurb}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ring-1 ring-foreground/10",
          "bg-card transition-[background-color,box-shadow,transform] duration-(--duration-fast) ease-(--ease-out) hover:bg-accent hover:ring-foreground/20 active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-background [&_svg]:size-3.5">
          {icon}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] leading-tight font-medium">{name}</span>
          <span className="truncate text-[11px] leading-tight text-muted-foreground">{role}</span>
        </span>
      </button>
    </form>
  );
}
