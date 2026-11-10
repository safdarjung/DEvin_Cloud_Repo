import type { ReactNode } from "react";
import type { TourRoleKey } from "../roles";
import { INK, YELLOW } from "./kit";

export const MASCOT_W = 200;
export const MASCOT_H = 220;

const stroke = { stroke: INK, strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** One small prop per role so the five mascots are not just recolours. */
const PROPS: Record<TourRoleKey, ReactNode> = {
  principal: <path d="M100 150 l-13 14 13 40 13 -40z" fill={YELLOW} {...stroke} />,
  admin: (
    <>
      <path d="M38 96 a62 62 0 0 1 124 0" fill="none" {...stroke} strokeWidth={8} />
      <rect x={24} y={90} width={24} height={38} rx={10} fill={YELLOW} {...stroke} />
      <path d="M36 128 q4 30 40 34" fill="none" {...stroke} />
    </>
  ),
  teacher: (
    <>
      <circle cx={74} cy={100} r={29} fill="none" {...stroke} />
      <circle cx={126} cy={100} r={29} fill="none" {...stroke} />
    </>
  ),
  student: (
    <>
      <path d="M100 8 l74 26 -74 26 -74 -26z" fill={INK} {...stroke} />
      <path d="M160 38 v30" {...stroke} stroke={YELLOW} />
    </>
  ),
  parent: <path d="M100 196 c-34 -22 -22 -44 0 -28 c22 -16 34 6 0 28z" fill="#fff" {...stroke} strokeWidth={5} />,
};

export interface MascotProps {
  role: TourRoleKey;
  accent: string;
  frame: number;
  /** 0..1 how hard the right arm waves. */
  wave?: number;
  /** -1..1 where the pupils point. */
  lookX?: number;
  lookY?: number;
  talking?: boolean;
}

export function Mascot({ role, accent, frame, wave = 0, lookX = 0, lookY = 0, talking = false }: MascotProps) {
  const blink = frame % 78 < 4 ? 0.1 : 1;
  const arm = -20 - wave * (40 + Math.sin(frame / 2.6) * 28);
  const mouth = talking ? 5 + Math.abs(Math.sin(frame / 3)) * 9 : 0;
  return (
    <svg width={MASCOT_W} height={MASCOT_H} viewBox="0 0 200 220" style={{ overflow: "visible", display: "block" }}>
      <ellipse cx={72} cy={208} rx={24} ry={10} fill={YELLOW} {...stroke} />
      <ellipse cx={128} cy={208} rx={24} ry={10} fill={YELLOW} {...stroke} />
      <path d="M34 138 q-26 10 -22 34" fill="none" {...stroke} strokeWidth={16} stroke={INK} />
      <path d="M34 138 q-26 10 -22 34" fill="none" stroke={accent} strokeWidth={7} strokeLinecap="round" />
      <g transform={`rotate(${arm} 166 138)`}>
        <path d="M166 138 q30 4 34 -30" fill="none" {...stroke} strokeWidth={16} />
        <path d="M166 138 q30 4 34 -30" fill="none" stroke={accent} strokeWidth={7} strokeLinecap="round" />
      </g>
      <rect x={28} y={36} width={144} height={172} rx={70} fill={accent} {...stroke} />
      <ellipse cx={100} cy={166} rx={44} ry={30} fill="#fff" opacity={0.28} />
      {[74, 126].map((cx) => (
        <g key={cx} transform={`translate(${cx} 100) scale(1 ${blink})`}>
          <circle r={22} fill="#fff" {...stroke} strokeWidth={5} />
          <circle cx={lookX * 8} cy={lookY * 8} r={10} fill={INK} />
          <circle cx={lookX * 8 + 4} cy={lookY * 8 - 4} r={3.5} fill="#fff" />
        </g>
      ))}
      {mouth ? (
        <ellipse cx={100} cy={138} rx={12} ry={mouth} fill={INK} />
      ) : (
        <path d="M86 134 q14 14 28 0" fill="none" {...stroke} />
      )}
      {PROPS[role]}
    </svg>
  );
}
