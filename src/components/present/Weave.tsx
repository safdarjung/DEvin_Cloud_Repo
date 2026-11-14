import type { CSSProperties } from "react";
import { THREADS } from "@/components/home/story";

const INK = "#1f2937";
const COLORS = THREADS.map((t) => t.color);

/**
 * The deck's signature: a woven check of the seven thread colours. Warp (vertical) and weft
 * (horizontal) bands pass over and under each other like cloth. Pure SVG, decorative.
 */
export function Weave({ band = 46, gap = 14, colors = COLORS, className }: { band?: number; gap?: number; colors?: readonly string[]; className?: string }) {
  const cell = band + gap;
  const size = colors.length * cell + gap;
  const at = (i: number) => gap + i * cell;
  const sw = 3;
  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden focusable="false">
      <rect width={size} height={size} rx={18} fill="#fff8ec" stroke={INK} strokeWidth={sw * 2} />
      {colors.map((c, j) => (
        <rect key={`weft-${j}`} x={sw} y={at(j)} width={size - sw * 2} height={band} fill={c} stroke={INK} strokeWidth={sw} />
      ))}
      {colors.map((c, i) => (
        <rect key={`warp-${i}`} x={at(i)} y={sw} width={band} height={size - sw * 2} fill={c} stroke={INK} strokeWidth={sw} />
      ))}
      {/* Where the weft passes over, repaint it across the warp (keeping its own top and bottom edges). */}
      {colors.flatMap((c, j) =>
        colors.map((_, i) =>
          (i + j) % 2 === 1 ? <rect key={`over-${i}-${j}`} x={at(i) - sw / 2} y={at(j) + sw / 2} width={band + sw} height={band - sw} fill={c} /> : null,
        ),
      )}
    </svg>
  );
}

/** A loose strand of yarn: a wavy line that ends in the thread's colour. */
export function Strand({ color, width = 160, height = 28, className, style }: { color: string; width?: number; height?: number; className?: string; style?: CSSProperties }) {
  const mid = height / 2;
  const amp = height / 2 - 5;
  const seg = width / 4;
  const d = `M2 ${mid} C ${seg * 0.5} ${mid - amp}, ${seg} ${mid + amp}, ${seg * 1.5} ${mid} S ${seg * 2.5} ${mid - amp}, ${seg * 3} ${mid} S ${width - 2} ${mid + amp * 0.6}, ${width - 2} ${mid}`;
  return (
    <svg className={className} style={style} viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden focusable="false">
      <path d={d} fill="none" stroke={INK} strokeWidth={11} strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" />
    </svg>
  );
}
