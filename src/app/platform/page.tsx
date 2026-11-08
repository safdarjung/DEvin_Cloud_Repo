import { EmptyState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { LimitedBadge } from "@/components/honesty";
import { KpiStrip, KpiTile } from "@/components/widgets/kpi-widget";
import { Card } from "@/components/ui/card";
import { FadeIn } from "@/components/motion";

const TILES = ["Total institutions", "Active", "Trial", "Paid subscriptions", "MRR", "Platform users"];

export default function PlatformOverview() {
  return (
    <>
      <PageHeader title="Platform overview" description="Cross-institution view for the platform owner." />
      <FadeIn>
        <KpiStrip>
          {TILES.map((label) => (
            <KpiTile key={label} label={label} value="—" sub="Needs platform backend" badge={<LimitedBadge />} />
          ))}
        </KpiStrip>
      </FadeIn>
      <FadeIn delay={0.06}>
        <Card className="mt-6">
          <EmptyState
            title="No platform data yet"
            description="Cross-institution figures need a platform read API (F-IDN-13, planned for P3). Row-level security limits every query to the caller's own schools, so nothing is shown rather than a made-up number."
          />
        </Card>
      </FadeIn>
    </>
  );
}
