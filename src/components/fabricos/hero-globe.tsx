import { LiveOrb } from "./live-orb";

/**
 * The FabricOS orb as a globe behind the hero. Wide screens with motion allowed only: phones and
 * reduced motion keep the still backdrop. Finer than the app orb (4), whose cells would be too
 * coarse to read as a net at this size.
 */
export function HeroGlobe() {
  return (
    <div className="fos-hx__anchor">
      <LiveOrb className="fos-hx__globe" freq={6} share={0.44} state="streaming" query="(min-width: 700px) and (prefers-reduced-motion: no-preference)" reach="window" scrollTurn={0.0024} />
    </div>
  );
}
