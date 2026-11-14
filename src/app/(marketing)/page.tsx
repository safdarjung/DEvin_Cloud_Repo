import "@/components/fabricos/fabricos.css";
import { AgentsSection } from "@/components/fabricos/agents-section";
import { AutomationSection } from "@/components/fabricos/automation-section";
import { ConfigureSection } from "@/components/fabricos/configure-section";
import { FaqSection } from "@/components/fabricos/faq-section";
import { FinalCta } from "@/components/fabricos/final-cta";
import { GuaranteesSection } from "@/components/fabricos/guarantees-section";
import { HeroStage } from "@/components/fabricos/hero-stage";
import { HomeJsonLd } from "@/components/fabricos/home-jsonld";
import { HowItWorksSection } from "@/components/fabricos/how-it-works-section";
import { InsightsSection } from "@/components/fabricos/insights-section";
import { LooseEnds } from "@/components/fabricos/loose-ends";
import { ModulesSection } from "@/components/fabricos/modules-section";
import { OrbSection } from "@/components/fabricos/orb-section";
import { ProductTour } from "@/components/fabricos/product-tour";
import { ProofStrip } from "@/components/fabricos/proof-strip";
import { RolesSection } from "@/components/fabricos/roles-section";
import { homeMetadata } from "@/components/fabricos/seo";
import { TourCta } from "@/components/fabricos/tour-cta";
import { TrustSection } from "@/components/fabricos/trust-section";
import { UseCasesSection } from "@/components/fabricos/use-cases-section";
import { HOME_MODULES } from "@/components/home/modules-list";

export const metadata = homeMetadata;

export default function HomePage() {
  return (
    <div className="fos overflow-x-clip">
      <HeroStage />
      <ProofStrip />
      <LooseEnds />
      <ProductTour />
      <RolesSection />
      <OrbSection />
      <AgentsSection media={false} />
      <AutomationSection media={false} />
      <InsightsSection media={false} />
      <ConfigureSection />
      <ModulesSection modules={HOME_MODULES} />
      <UseCasesSection />
      <TrustSection />
      <GuaranteesSection />
      <HowItWorksSection />
      <TourCta />
      <FaqSection />
      <FinalCta />
      <HomeJsonLd />
    </div>
  );
}
