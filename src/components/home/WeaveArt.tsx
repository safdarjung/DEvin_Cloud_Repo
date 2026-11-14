import type { CSSProperties } from "react";
import { THREADS } from "./story";

const INK = "#1f2937";

/**
 * A plain-weave swatch drawn in SVG: the static stand-in for the 3D cloth (no WebGL, reduced motion) and
 * the page's recurring motif. Each strand is one rounded bar; where two cross, the one on top is drawn last.
 */
export function WeaveArt({ lanes = 7, className, title, reveal }: { lanes?: number; className?: string; title?: string; reveal?: boolean }) {
  const cell = 40;
  const pad = 26;
  const band = 22;
  const size = pad * 2 + lanes * cell;
  const at = (i: number) => pad + i * cell + cell / 2;
  const color = (i: number, shift = 0) => THREADS[(i + shift) % THREADS.length].color;
  /** `--i` staggers the weave-in animation (home-motion.css). */
  const order = (i: number) => ({ "--i": i }) as CSSProperties;
  const bars = [];
  // Full-length strands first (with their ink outline), then a patch per crossing to put the right one on top.
  for (let i = 0; i < lanes; i++) {
    bars.push(<rect key={`h${i}`} className="lm-strand" data-kind="h" style={order(i)} x={6} y={at(i) - band / 2} width={size - 12} height={band} rx={band / 2} fill={color(i)} stroke={INK} strokeWidth={3} />);
  }
  for (let i = 0; i < lanes; i++) {
    bars.push(<rect key={`v${i}`} className="lm-strand" data-kind="v" style={order(i)} x={at(i) - band / 2} y={6} width={band} height={size - 12} rx={band / 2} fill={color(i, 3)} stroke={INK} strokeWidth={3} />);
  }
  for (let r = 0; r < lanes; r++) {
    for (let c = 0; c < lanes; c++) {
      if ((r + c) % 2 === 0) continue; // the vertical strand, drawn last, already sits on top here
      bars.push(
        <g key={`x${r}-${c}`} className="lm-cross" style={order(Math.max(r, c))}>
          <rect x={at(c) - cell / 2 + 3} y={at(r) - band / 2} width={cell - 6} height={band} fill={color(r)} />
          <path d={`M${at(c) - cell / 2 + 3} ${at(r) - band / 2}h${cell - 6}M${at(c) - cell / 2 + 3} ${at(r) + band / 2}h${cell - 6}`} stroke={INK} strokeWidth={3} />
        </g>,
      );
    }
  }
  return (
    <svg className={`lm-weave${className ? ` ${className}` : ""}`} data-reveal={reveal ? "" : undefined} viewBox={`0 0 ${size} ${size}`} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {bars}
    </svg>
  );
}
