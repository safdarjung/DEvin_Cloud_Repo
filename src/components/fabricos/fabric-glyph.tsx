import { useId } from "react";
import { ORB_MARK, ORB_MARK_VIEWBOX } from "./orb-mark-paths";

/**
 * FabricOS mark: the orb, a hollow sphere of linked joints. The near half takes the text colour;
 * the far half shows through it in the brand gradient.
 */
export function FabricGlyph({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox={ORB_MARK_VIEWBOX} className={className} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="-40" y1="-40" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#67d7ea" />
          <stop offset="1" stopColor="#8b93ff" />
        </linearGradient>
      </defs>
      <path d={ORB_MARK.far} stroke={`url(#${id})`} strokeOpacity="0.55" strokeWidth="2.9" />
      <path d={ORB_MARK.near} stroke="currentColor" strokeWidth="4.6" />
    </svg>
  );
}
