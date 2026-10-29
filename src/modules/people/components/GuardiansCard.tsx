// T-028 — guardians card. A freshly enrol-created guardian has no `user_id`
// (DBT-12 — no portal login provisioned at enrolment); the honesty label
// (CLAUDE.md rule 7) marks that gap wherever it's shown.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LimitedBadge } from "@/components/honesty";
import type { GuardianRow } from "@/modules/people/queries";

export function GuardiansCard({ guardians }: { guardians: GuardianRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Guardians</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {guardians.length === 0 && <p className="text-muted-foreground text-sm">No guardian on record.</p>}
        {guardians.map((g) => (
          <div key={g.id} className="space-y-1 border-border border-b pb-2 last:border-0 last:pb-0">
            <p className="text-sm font-medium">
              {g.fullName} <span className="text-muted-foreground font-normal">({g.relationship}{g.isPrimary ? ", primary" : ""})</span>
            </p>
            <p className="text-muted-foreground text-sm">
              {g.phone}
              {g.email ? ` · ${g.email}` : ""}
            </p>
            {!g.hasPortalLogin && (
              <div className="flex items-center gap-2">
                <LimitedBadge />
                <span className="text-muted-foreground text-xs">Guardian login invite not yet available</span>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
