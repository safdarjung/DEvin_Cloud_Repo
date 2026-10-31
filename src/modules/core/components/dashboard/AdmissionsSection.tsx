import type { DashboardDTO } from "@/modules/core/dashboard.queries";
import { FunnelChart } from "./FunnelChart";
import { Section } from "./Section";

export function AdmissionsSection({ funnel }: { funnel: DashboardDTO["funnel"] }) {
  return (
    <Section title="Admissions funnel">
      <FunnelChart funnel={funnel} />
    </Section>
  );
}
