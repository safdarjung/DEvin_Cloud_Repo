import { Badge } from "@/components/ui/badge";

export interface ProviderBadgeProps {
  provider: "local" | "cloud";
}

/**
 * Honesty label (CLAUDE.md rule 7, 06 §W6 "Feedback") — the only place a
 * teacher is told whether a quiz came from the local model or the cloud.
 */
export function ProviderBadge({ provider }: ProviderBadgeProps) {
  return (
    <Badge variant="secondary">
      {provider === "local" ? "Generated locally" : "Generated in cloud (redacted)"}
    </Badge>
  );
}
