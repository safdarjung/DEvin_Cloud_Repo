// FabricOS mark for next/og images (icons, OG card). Same geometry as
// FabricGlyph (fabric-glyph.tsx) but hook-free with fixed colours, because
// ImageResponse cannot run useId or inherit currentColor from page CSS.
export const MARK_BG = "#0b1020";

export function FabricMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeWidth="2.4" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fos-warp" x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#67d7ea" />
          <stop offset="1" stopColor="#8b93ff" />
        </linearGradient>
      </defs>
      {/* weft (horizontal) */}
      <path d="M3.5 8H5.6M10.4 8H20.5M3.5 16H13.6M18.4 16H20.5" stroke="#ffffff" />
      {/* warp (vertical) */}
      <path d="M8 3.5V13.6M8 18.4V20.5M16 3.5V5.6M16 10.4V20.5" stroke="url(#fos-warp)" />
    </svg>
  );
}
