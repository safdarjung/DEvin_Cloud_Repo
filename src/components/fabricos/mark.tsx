// FabricOS mark for next/og images (icons, OG card). Same geometry as
// FabricGlyph (fabric-glyph.tsx) but hook-free with fixed colours, because
// ImageResponse cannot run useId or inherit currentColor from page CSS.
import { ORB_MARK, ORB_MARK_VIEWBOX } from "./orb-mark-paths";

export const MARK_BG = "#0b1020";

export function FabricMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox={ORB_MARK_VIEWBOX} fill="none" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fos-orb" x1="-40" y1="-40" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#67d7ea" />
          <stop offset="1" stopColor="#8b93ff" />
        </linearGradient>
      </defs>
      <path d={ORB_MARK.far} stroke="url(#fos-orb)" strokeOpacity="0.55" strokeWidth="2.9" />
      <path d={ORB_MARK.near} stroke="#ffffff" strokeWidth="4.6" />
    </svg>
  );
}
