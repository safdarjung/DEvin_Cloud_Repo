// Home hero: the claim, then the product itself. The screen is the real recording of the demo
// school, standing in 3D until scroll lays it flat (hero-tilt.tsx); the orb rises behind it as a
// globe (hero-globe.tsx); the cards around it preview later sections and link to them.
// Server component: the H1 is in the SSR HTML.
import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight, Check, Lock, PencilLine, Sparkles, TrendingUp } from "lucide-react";
import { HOME_STATS } from "@/components/home/stats";
import { AGENT_DEMO, BRAND, CTA, SECTION, TRUST } from "./content";
import { HeroGlobe } from "./hero-globe";
import { HeroTilt } from "./hero-tilt";
import { ProductVideo } from "./product-video";
import "./landing.css";

const at = (i: number) => ({ "--i": i }) as CSSProperties;

export function HeroStage() {
  return (
    <section className="fos-hx" aria-labelledby="fos-hero-title">
      <p className="fos-eyebrow fos-up" style={at(0)}>
        {BRAND} · AI operating system for institutions
      </p>
      <h1 id="fos-hero-title" className="fos-hx__title">
        Run the whole institution on <em>one live system.</em>
      </h1>
      <p className="fos-hx__lead fos-up" style={at(2)}>
        Admissions, attendance, fees, exams and {HOME_STATS.modules - 4} more modules on one set of records.{" "}
        <strong>AI agents draft the routine work. A person approves every change.</strong>
      </p>
      <div className="fos-hx__ctas fos-up" style={at(3)}>
        <Link href={CTA.primary.href} className="fos-btn fos-btn-primary">
          {CTA.primary.label}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
        <Link href={CTA.secondary.href} className="fos-btn fos-btn-ghost">
          {CTA.secondary.label}
        </Link>
      </div>
      <p className="fos-hx__note fos-up" style={at(4)}>
        No sign-up for the demo: pick a role and look around a sample school. Or <Link href={CTA.tour.href}>walk a school day in 3D</Link>.
      </p>

      <HeroGlobe />
      <HeroTilt>
        <span className="fos-hx__glow" aria-hidden />
        <div className="fos-hx__window">
          <ProductVideo id="overview" variant="loop" eager />
        </div>

        <a href={`#${SECTION.trust}`} className="fos-hx__card fos-hx__card--proposal" style={at(0)}>
          <span className="fos-hx__kicker">
            <Sparkles aria-hidden /> AI draft
          </span>
          <strong>{TRUST.proposal.title.replace("Agent proposal: ", "").replace(/^./, (c) => c.toUpperCase())}</strong>
          <span className="fos-hx__wait">Waiting for a person</span>
          <span className="fos-hx__pills" aria-hidden>
            <span>
              <Check /> Approve
            </span>
            <span>
              <PencilLine /> Edit
            </span>
          </span>
        </a>

        <a href={`#${SECTION.insights}`} className="fos-hx__card fos-hx__card--attendance" style={at(1)}>
          <span className="fos-hx__kicker">
            <TrendingUp aria-hidden /> Attendance today
          </span>
          <span className="fos-hx__big">94%</span>
          <svg viewBox="0 0 120 28" className="h-7 w-full" aria-hidden>
            <path d="M0 20 L17 16 L34 18 L51 9 L68 12 L85 6 L102 10 L120 4" fill="none" stroke="var(--th-attendance)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>3 classes below their usual</span>
        </a>

        <a href={`#${SECTION.agents}`} className="fos-hx__card fos-hx__card--agent" style={at(2)}>
          <span className="fos-hx__kicker">
            <Sparkles aria-hidden /> Class teacher asks
          </span>
          <strong>“{AGENT_DEMO.request.split(",")[0]}?”</strong>
          <span className="fos-hx__typing">
            <i aria-hidden>
              <b />
              <b />
              <b />
            </i>
            Drafting a note to each family
          </span>
        </a>

        <a href={`#${SECTION.trust}`} className="fos-hx__card fos-hx__card--receipt" style={at(3)}>
          <span className="fos-hx__kicker">
            <Lock aria-hidden /> Receipt R-0412
          </span>
          <strong>₹14,500 · Term fee</strong>
          <span>Locked. A correction adds a new version.</span>
        </a>
      </HeroTilt>

      <p className="fos-tag fos-hx__legend">The screen is a recording of the demo school. The cards are illustrations with sample data.</p>
    </section>
  );
}
