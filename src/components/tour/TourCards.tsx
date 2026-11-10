import { ArrowDown, ArrowRight, CalendarCheck, Play } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { StopKey } from "./path";
import { TOUR_ROLES, type TourRole, type TourRoleKey } from "./roles";

export const ROLE = Object.fromEntries(TOUR_ROLES.map((r) => [r.key, r])) as Record<TourRoleKey, TourRole>;
export const roleAt = (key: StopKey): TourRole | undefined => (key === "gate" || key === "finale" ? undefined : ROLE[key]);
export const stopLabel = (key: StopKey) => roleAt(key)?.room ?? (key === "gate" ? "School gate" : "Back garden");
export const accentVar = (accent?: string) => ({ "--role": accent ?? "var(--mk-accent)" }) as CSSProperties;
/** Rail dot colour: role accent, brand blue for the gate, gold for the finale. */
export const stopAccent = (key: StopKey) => roleAt(key)?.accent ?? (key === "finale" ? "#ffb800" : undefined);

export function GateCard({ film = false, onStart }: { film?: boolean; onStart: () => void }) {
  return (
    <>
      <p className="tour-eyebrow">School tour</p>
      <h1 id="tour-gate-title" className="tour-title">
        Walk through a school day
      </h1>
      <p className="tour-tagline">Five people keep a school running. Meet each of them, see what Fabric does for them, and try their demo.</p>
      <div className="tour-actions">
        <button type="button" className="tour-btn" onClick={onStart}>
          Start the tour <ArrowRight aria-hidden className="size-4" />
        </button>
      </div>
      <p className="tour-hint">
        <ArrowDown aria-hidden className="size-4" />
        {film ? "Scroll to open the gate. Poke the bell, the trees and the flag." : "Scroll down to meet each of them."}
      </p>
    </>
  );
}

export function RoleCard({ role, index, onFeatures }: { role: TourRole; index: number; onFeatures: (key: TourRoleKey) => void }) {
  return (
    <>
      <p className="tour-eyebrow">
        <span className="tour-pill">
          Stop {index} of {TOUR_ROLES.length}
        </span>
        {role.room}
      </p>
      <h2 id={`tour-${role.key}-title`} className="tour-title">
        {role.label}
      </h2>
      <p className="tour-tagline">{role.tagline}</p>
      <div className="tour-actions">
        <button type="button" className="tour-btn" onClick={() => onFeatures(role.key)}>
          <Play aria-hidden className="size-4" />
          Show features<span className="sr-only"> for the {role.label.toLowerCase()}</span>
        </button>
        <DemoForm role={role} ghost />
      </div>
    </>
  );
}

export function FinaleCard() {
  return (
    <>
      <p className="tour-eyebrow">That was the tour</p>
      <h2 id="tour-finale-title" className="tour-title">
        One school, five people, one system
      </h2>
      <p className="tour-tagline">See Fabric with your own school in mind, or jump into a demo account right now.</p>
      <div className="tour-actions">
        <Link href="/contact" className="tour-btn">
          <CalendarCheck aria-hidden className="size-4" />
          Book a demo
        </Link>
        <Link href="/demo" className="tour-btn tour-btn-ghost">
          Try a demo <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </>
  );
}

/** Same as the /demo role cards: plain form, no JS, so an early click still submits natively. */
export function DemoForm({ role, ghost = false }: { role: TourRole; ghost?: boolean }) {
  return (
    <form method="post" action="/api/public/demo-login">
      <input type="hidden" name="email" value={role.demoEmail} />
      <button type="submit" className={ghost ? "tour-btn tour-btn-ghost" : "tour-btn"}>
        Try the {role.label} demo <ArrowRight aria-hidden className="size-4" />
      </button>
    </form>
  );
}
