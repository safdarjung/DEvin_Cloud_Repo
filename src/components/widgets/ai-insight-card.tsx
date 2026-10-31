// Pure display. Buttons only navigate (href) — an insight never calls an action
// (CLAUDE.md rule 6: AI output is a suggestion a human acts on).
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { FadeIn } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export interface AIInsightCardProps {
  title: string;
  detected: string;
  whyItMatters: string;
  evidence: string[];
  suggestedAction: { label: string; href?: string };
  requiresApproval?: boolean;
  confidence?: "low" | "medium" | "high";
}

export function AIInsightCard({ title, detected, whyItMatters, evidence, suggestedAction, requiresApproval, confidence }: AIInsightCardProps) {
  return (
    <FadeIn className="min-w-0">
      <article className="h-full space-y-3 rounded-xl border border-primary/25 bg-primary/[0.03] p-4 text-sm">
        <header className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h3 className="font-medium">{title}</h3>
          {confidence && <Badge variant="outline">{confidence} confidence</Badge>}
          {requiresApproval && <Badge variant="warning">Needs approval</Badge>}
        </header>
        <p>{detected}</p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Why it matters: </span>
          {whyItMatters}
        </p>
        {evidence.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {suggestedAction.href ? (
          <Link href={suggestedAction.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {suggestedAction.label}
          </Link>
        ) : (
          <p className="text-xs font-medium text-primary">Suggested: {suggestedAction.label}</p>
        )}
      </article>
    </FadeIn>
  );
}
