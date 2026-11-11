// F-UI-12 (live-fabric studio lane) — Request / Proposal / Status tabs.
// No sandboxed preview or install-from-studio: this lane has no real build
// pipeline (BRIEF "no fake agent pipeline"), so in_progress/delivered are
// shown as future steps the CoolSkool team completes by hand, not a demo.
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/states";
import { LimitedBadge } from "@/components/honesty";
import { humanize, inr } from "@/lib/format";
import type { CatalogModule, StudioRequestRecord, StudioRequestStatus } from "@/modules/fabric/studio.queries";
import { StudioControls } from "./studio-controls";

const TIMELINE: StudioRequestStatus[] = ["submitted", "proposed", "approved", "in_progress", "delivered"];

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">None</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function RequestDetail({
  institutionSlug,
  base,
  request,
  canApprove,
  catalogMatches = [],
}: {
  institutionSlug: string;
  base: string;
  request: StudioRequestRecord;
  canApprove: boolean;
  /** Existing modules whose wording overlaps the request (studio.queries catalogMatches) — shown before proposing. */
  catalogMatches?: CatalogModule[];
}) {
  const proposal = request.proposal;
  const rejected = request.status === "rejected";
  const currentIndex = rejected ? TIMELINE.indexOf("proposed") : TIMELINE.indexOf(request.status);

  return (
    <Card>
      <CardHeader>
        <Link href={base} className="mb-1 inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden">
          <ArrowLeft className="size-4" aria-hidden /> Back to board
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{request.title}</CardTitle>
          <Badge variant={rejected ? "destructive" : "secondary"}>{humanize(request.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="request">
          <TabsList>
            <TabsTrigger value="request">Request</TabsTrigger>
            <TabsTrigger value="proposal">Proposal</TabsTrigger>
            <TabsTrigger value="status">Status</TabsTrigger>
          </TabsList>

          <TabsContent value="request" className="space-y-3 pt-3">
            <div>
              <p className="text-sm font-medium">Problem</p>
              <p className="text-sm text-muted-foreground">{request.problem}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Desired outcome</p>
              <p className="text-sm text-muted-foreground">{request.desiredOutcome}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-sm font-medium">User roles</p>
                <List items={request.context.userRoles ?? []} />
              </div>
              <div>
                <p className="text-sm font-medium">Existing systems</p>
                <List items={request.context.existingSystems ?? []} />
              </div>
              <div>
                <p className="text-sm font-medium">Integrations</p>
                <List items={request.context.integrations ?? []} />
              </div>
              <div>
                <p className="text-sm font-medium">Constraints</p>
                <p className="text-sm text-muted-foreground">{request.context.constraints || "None"}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-sm font-medium">Budget range</p>
                <p className="text-sm text-muted-foreground">{humanize(request.terms.budgetRange ?? "unknown")}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Timeline</p>
                <p className="text-sm text-muted-foreground">{request.terms.timeline}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Success criteria</p>
                <p className="text-sm text-muted-foreground">{request.terms.successCriteria}</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="proposal" className="space-y-3 pt-3">
            {!proposal ? (
              <EmptyState title="No proposal yet" description="Generate one from the Status tab once the request is reviewed." />
            ) : (
              <div className="space-y-3">
                <Badge variant="info">{humanize(proposal.resolution)}</Badge>
                <p className="text-sm">{proposal.interpretation}</p>
                {proposal.clarifyingQuestions.length > 0 && (
                  <div>
                    <p className="text-sm font-medium">Clarifying questions</p>
                    <List items={proposal.clarifyingQuestions} />
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium">Features</p>
                    <List items={proposal.features} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Workflows</p>
                    <List items={proposal.workflows} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">UX outline</p>
                    <List items={proposal.uxOutline} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Technical requirements</p>
                    <List items={proposal.technicalRequirements} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Integration requirements</p>
                    <List items={proposal.integrationRequirements} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Permission requirements</p>
                    <List items={proposal.permissionRequirements} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Risks</p>
                    <List items={proposal.risks} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Acceptance criteria</p>
                    <List items={proposal.acceptanceCriteria} />
                  </div>
                </div>
                <div className="flex gap-6 border-t pt-3 text-sm">
                  <span>
                    Estimated cost: <strong>{inr(proposal.costEstimatePaise / 100)}</strong>
                  </span>
                  <span>
                    Estimated timeline: <strong>{proposal.timelineWeeks} weeks</strong>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  <LimitedBadge /> No sandboxed preview or in-app install for a custom build yet — the CoolSkool team ships it and installs it once approved.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="status" className="space-y-4 pt-3">
            <ol className="space-y-2">
              {TIMELINE.map((step, i) => {
                const done = !rejected && i <= currentIndex;
                const future = step === "in_progress" || step === "delivered";
                return (
                  <li key={step} className="flex items-center gap-2 text-sm">
                    {done ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />}
                    <span className={done ? "font-medium" : "text-muted-foreground"}>{humanize(step)}</span>
                    {future && <LimitedBadge />}
                    {future && <span className="text-xs text-muted-foreground">built by the CoolSkool team</span>}
                  </li>
                );
              })}
              {rejected && (
                <li className="flex items-center gap-2 text-sm">
                  <XCircle className="size-4 text-destructive" aria-hidden />
                  <span className="font-medium">Rejected</span>
                </li>
              )}
            </ol>
            {request.notes.length > 0 && (
              <div>
                <p className="text-sm font-medium">Notes</p>
                <List items={request.notes} />
              </div>
            )}
            {request.status === "submitted" && catalogMatches.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">May already exist</p>
                <p className="text-xs text-muted-foreground">Word match against the module catalog, before asking AI for a proposal.</p>
                <ul className="space-y-1.5 text-sm">
                  {catalogMatches.map((m) => (
                    <li key={m.key} className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{m.label}</span>
                      <Badge variant={m.enabled ? "success" : "secondary"}>{m.enabled ? "On" : "Off"}</Badge>
                      <span className="text-muted-foreground">{m.description}</span>
                    </li>
                  ))}
                </ul>
                <Link href={`/${institutionSlug}/fabric/marketplace`} className="text-sm text-primary hover:underline">
                  Browse modules
                </Link>
              </div>
            )}
            <StudioControls institutionSlug={institutionSlug} requestId={request.id} status={request.status} canApprove={canApprove} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
