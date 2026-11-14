import "@/components/fabricos/fabricos.css";
import { AgentsSection } from "@/components/fabricos/agents-section";
import { AutomationSection } from "@/components/fabricos/automation-section";
import { ConfigureSection } from "@/components/fabricos/configure-section";
import { ConnectedSection } from "@/components/fabricos/connected-section";
import { FaqSection } from "@/components/fabricos/faq-section";
import { FinalCta } from "@/components/fabricos/final-cta";
import { HeroStory } from "@/components/fabricos/hero-story";
import { HomeJsonLd } from "@/components/fabricos/home-jsonld";
import { HowItWorksSection } from "@/components/fabricos/how-it-works-section";
import { InsightsSection } from "@/components/fabricos/insights-section";
import { ProblemSection } from "@/components/fabricos/problem-section";
import { homeMetadata } from "@/components/fabricos/seo";
import { ShowcaseSection } from "@/components/fabricos/showcase-section";
import { TourCta } from "@/components/fabricos/tour-cta";
import { TrustSection } from "@/components/fabricos/trust-section";
import { UseCasesSection } from "@/components/fabricos/use-cases-section";

export const metadata = homeMetadata;

export default function HomePage() {
  return (
    <div className="fos overflow-x-clip">
      <HeroStory />
      <ProblemSection />
      <ShowcaseSection />
      <AgentsSection />
      <ConfigureSection />
      <AutomationSection />
      <InsightsSection />
      <ConnectedSection />
      <UseCasesSection />
      <TrustSection />
      <HowItWorksSection />
      <TourCta />
      <FaqSection />
      <FinalCta />
      <HomeJsonLd />
    </div>
  );
}
