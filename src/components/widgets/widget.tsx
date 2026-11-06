// Shared frame for dashboard widgets: Card, consistent header row, entrance fade.
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { FadeIn } from "@/components/motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "cn";

export interface WidgetProps {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  icon?: ReactNode;
  children?: ReactNode;
  /** Shown instead of `children` when `isEmpty`. */
  empty?: ReactNode;
  isEmpty?: boolean;
  className?: string;
}

export function Widget({ title, description, action, icon, children, empty, isEmpty, className }: WidgetProps) {
  return (
    <FadeIn className={cn("min-w-0", className)}>
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
                {title}
              </CardTitle>
              {description && <CardDescription className="mt-1">{description}</CardDescription>}
            </div>
            {action && (
              <Link
                href={action.href}
                className="inline-flex shrink-0 items-center gap-1 rounded-md py-1 text-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {action.label}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent>{isEmpty && empty ? empty : children}</CardContent>
      </Card>
    </FadeIn>
  );
}
