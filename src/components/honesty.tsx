import { Badge } from "@/components/ui/badge";

/**
 * Marks a UI surface backed by a simulated channel or a limited feature
 * (CLAUDE.md rule 7). Docs and UI must agree on where these appear.
 */
export function SimulatedBadge() {
  return <Badge variant="secondary">Simulated</Badge>;
}

export function LimitedBadge() {
  return <Badge variant="secondary">Limited</Badge>;
}
