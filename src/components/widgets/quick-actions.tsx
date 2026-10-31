import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Widget, type WidgetProps } from "@/components/widgets/widget";
import { cn } from "cn";

export interface QuickAction {
  href: string;
  label: string;
  icon: ReactNode;
}

/** Caller passes only actions the user is permitted to do; this is navigation, not authorization. */
export function QuickActions({
  actions,
  title = "Quick actions",
  ...frame
}: Omit<WidgetProps, "children" | "empty" | "isEmpty" | "title"> & { actions: QuickAction[]; title?: string }) {
  if (actions.length === 0) return null;
  return (
    <Widget title={title} {...frame}>
      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        {actions.map((a) => (
          <Link key={a.href + a.label} href={a.href} className={cn(buttonVariants({ variant: "outline" }), "justify-start gap-2")}>
            <span className="text-muted-foreground" aria-hidden>
              {a.icon}
            </span>
            {a.label}
          </Link>
        ))}
      </div>
    </Widget>
  );
}
