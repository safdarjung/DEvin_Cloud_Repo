// M19-T12 rulings "resource-shortage": one school-level `operations.room_pressure`
// candidate from `public.insight_src_rooms` (one row per room). Window is the
// timetable version id, not an ISO week (Signals table).
// Relative `.ts` value imports: `pnpm jobs:run` loads this file.
import type { InsightSeverity } from "@/modules/fabric/types";
import { makeCandidate, pct, type Detector, type InsightCandidate } from "../signals.ts";

const VERSION = 1;
const ACTIONS = [
  "Review the week's room allocations and move some sections out of the busiest rooms.",
  "Check open maintenance requests on the busiest rooms and prioritise the ones blocking capacity.",
];

/** One row of `public.insight_src_rooms`. Empty array when there is no published version. */
export interface RoomSourceRow {
  version_id: string;
  room_id: string;
  room_name: string;
  periods_used: number;
  periods_total: number;
  open_maintenance: number;
}

export function detectRoomPressure(rows: RoomSourceRow[], asOf: string): InsightCandidate[] {
  if (rows.length === 0) return [];
  const total = rows[0].periods_total;
  if (total === 0) return [];
  const inUse = rows.filter((r) => r.periods_used >= 1);
  const hot = inUse.filter((r) => 10 * r.periods_used >= 9 * total); // used/total >= 0.9
  if (hot.length < 2 || 5 * hot.length < inUse.length) return []; // hot >= 0.2 x in-use
  const openRepairs = hot.reduce((n, r) => n + r.open_maintenance, 0);
  const severity: InsightSeverity = 5 * hot.length >= 2 * inUse.length || openRepairs >= 1 ? "warning" : "watch"; // hot >= 0.4 x in-use
  const top = [...hot]
    .sort((a, b) => b.periods_used - a.periods_used || (a.room_name < b.room_name ? -1 : 1))
    .slice(0, 3);
  return [
    makeCandidate("operations.room_pressure", VERSION, {
      severity,
      title: "Teaching rooms close to full",
      pattern: `${hot.length} of ${inUse.length} rooms in use are booked at 90% or more of the week's periods as of ${asOf}, with ${openRepairs} open repair${openRepairs === 1 ? "" : "s"} among them.`,
      evidence: [
        { label: "Rooms ≥ 90% booked", value: hot.length },
        { label: "Rooms in use", value: inUse.length },
        { label: "Open repairs in busy rooms", value: openRepairs },
        ...top.map((r) => ({ label: `${r.room_name} booked`, value: pct(r.periods_used, total) ?? 0, unit: "%" })),
      ],
      sources: ["timetable_slots", "rooms", "periods", "maintenance_requests"],
      date_from: asOf,
      date_to: asOf,
      confidence: 0.9,
      recommended_actions: ACTIONS,
      entity_type: null,
      entity_id: null,
      entity_label: null,
      class_section_id: null,
      window: rows[0].version_id,
    }),
  ];
}

export const resourceShortageDetector: Detector = {
  key: "resource-shortage",
  module: "timetable",
  version: VERSION,
  async run(admin, { institutionId, asOf }) {
    // Rows = rooms in the institution: far below max_rows, so no `.range()` paging.
    const { data, error } = await admin.rpc("insight_src_rooms", { p_institution_id: institutionId, p_as_of: asOf });
    if (error) throw error;
    return detectRoomPressure(data ?? [], asOf);
  },
};
