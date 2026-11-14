import { useId } from "react";

/**
 * FabricOS mark: two warp and two weft threads woven over and under each other.
 * Gaps in a stroke show where that thread passes underneath.
 */
export function FabricGlyph({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" strokeLinecap="round" strokeWidth="2.4" aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#67d7ea" />
          <stop offset="1" stopColor="#8b93ff" />
        </linearGradient>
      </defs>
      {/* Set on the diagonal so it reads as cloth, not a hash sign. */}
      <g transform="translate(12 12) rotate(45) scale(0.92) translate(-12 -12)">
        {/* weft */}
        <path d="M3.5 8H5.6M10.4 8H20.5M3.5 16H13.6M18.4 16H20.5" stroke="currentColor" />
        {/* warp */}
        <path d="M8 3.5V13.6M8 18.4V20.5M16 3.5V5.6M16 10.4V20.5" stroke={`url(#${id})`} />
      </g>
    </svg>
  );
}
