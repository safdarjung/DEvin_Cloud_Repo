import { ArrowRight, BookOpenCheck, CalendarCheck, Globe, Landmark, Lock, PenLine, Tag, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { HONESTY_TEXT, PLAIN_FACTS, START_STEPS, THREADS, TRUST } from "@/components/home/story";
import { TOUR_ROLES } from "@/components/tour/roles";
import { Weave } from "../Weave";
import "./closing.css";

const TRUST_ICON: Record<string, LucideIcon> = { walls: Landmark, locks: Lock, ink: PenLine, labels: Tag };

export function TrustSlide() {
  return (
    <div className="tr-wrap">
      <h2 className="lm-display tr-h2">
        <Weave className="tr-weave" band={10} gap={4} /> Built to be trusted
      </h2>
      <ul className="tr-grid">
        {TRUST.map((t, i) => {
          const Icon = TRUST_ICON[t.key] ?? Lock;
          return (
            <li key={t.key} className="lm-card tr-card" style={{ "--th": THREADS[i * 2]?.color } as CSSProperties}>
              <h3>
                <span className="tr-icon" aria-hidden>
                  <Icon />
                </span>
                {t.title}
              </h3>
              <p>{t.body}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PlainSlide() {
  return (
    <div className="pl-wrap">
      <div className="pl-head">
        <p className="dk-eyebrow">No small print</p>
        <h2 className="lm-display pl-h2">Stated plainly</h2>
        <p className="dk-body">If something is simulated or limited, the screen says so in words.</p>
      </div>
      <ul className="pl-list">
        {PLAIN_FACTS.map((f) => (
          <li key={f.label}>
            <p>
              <span className="lm-honest pl-stamp">{f.label === "planned" ? "Planned" : HONESTY_TEXT[f.label]}</span>
              {f.text}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

const START_COLORS = ["var(--th-admissions)", "var(--th-office)", "var(--th-parents)"];

export function StartSlide() {
  return (
    <div className="s-wrap">
      <p className="dk-eyebrow">Getting started</p>
      <h2 className="lm-display dk-h2">How a school starts</h2>
      <ol className="s-steps">
        {START_STEPS.map((s, i) => (
          <li key={s.title} style={{ "--th": START_COLORS[i] } as CSSProperties}>
            <span className="lm-display s-num" aria-hidden>
              {i + 1}
            </span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
      <p className="s-price">
        <span className="lm-chip dk-chip">Pricing</span> Quoted per school.
      </p>
    </div>
  );
}

export function TrySlide() {
  return (
    <div className="y-wrap">
      <div className="y-copy">
        <p className="dk-eyebrow">Your turn</p>
        <h2 className="lm-display y-h2">Try it now</h2>
        <p className="dk-body">One click opens the demo school as that person.</p>
        <nav className="y-links" aria-label="More about Fabric">
          <Link href="/tour" className="lm-btn dk-btn">
            <BookOpenCheck aria-hidden className="dk-ico" /> 3D school tour
          </Link>
          <Link href="/contact" className="lm-btn dk-btn" data-kind="ink">
            <CalendarCheck aria-hidden className="dk-ico" /> Book a demo
          </Link>
          <Link href="/" className="lm-btn dk-btn" data-kind="paper">
            <Globe aria-hidden className="dk-ico" /> Fabric website
          </Link>
        </nav>
      </div>
      <ul className="y-demos">
        {TOUR_ROLES.map((r) => (
          <li key={r.key}>
            {/* Same as DemoForm in src/components/tour/TourCards.tsx: a plain form, so it works before hydration. */}
            <form method="post" action="/api/public/demo-login">
              <input type="hidden" name="email" value={r.demoEmail} />
              <button type="submit" className="y-demo" style={{ "--role": r.accent } as CSSProperties}>
                <span className="y-swatch" aria-hidden />
                Try the {r.label} demo
                <ArrowRight aria-hidden className="dk-ico y-arrow" />
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
