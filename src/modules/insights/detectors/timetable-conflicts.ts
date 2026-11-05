// M19-T11 rulings "timetable-conflicts": `operations.room_capacity` from
// `public.insight_src_room_capacity`. Double-booking cannot happen (0069
// constraints) and teacher overload is `staff.workload`, so room size is the
// only conflict left to detect.
// Relative `.ts` value imports: `pnpm jobs:run` loads this file.
import type { InsightSeverity } from "@/modules/fabric/types";
import { makeCandidate, type Detector, type InsightCandidate } from "../signals.ts";

const VERSION = 1;
const PAGE_SIZE = 1000; // PostgREST's own max_rows
const ACTIONS = [
  "Move this section's periods into rooms that seat the whole class.",
  "If no larger room is free, split the section for those periods or add seating.",
];

/** One row of `public.insight_src_room_capacity`. */
export interface RoomCapacitySourceRow {
  version_id: string;
  class_section_id: string;
  section_label: string;
  strength: number;
  smallest_capacity: number;
  slots_over: number;
}

export function detectRoomCapacity(rows: RoomCapacitySourceRow[], asOf: string): InsightCandidate[] {
  return rows.map((r) => {
    const severity: InsightSeverity =
      r.strength - r.smallest_capacity >= 10 || r.slots_over >= 12 ? "warning" : "watch";
    return makeCandidate("operations.room_capacity", VERSION, {
      severity,
      title: `Rooms too small for ${r.section_label}`,
      pattern: `${r.section_label} has ${r.strength} students, but ${r.slots_over} of its weekly periods are in rooms that seat fewer; the smallest seats ${r.smallest_capacity}.`,
      evidence: [
        { label: "Section strength", value: r.strength },
        { label: "Smallest room capacity", value: r.smallest_capacity },
        { label: "Periods in too-small rooms", value: r.slots_over },
      ],
      sources: ["timetable_slots", "rooms", "enrolments"],
      date_from: asOf,
      date_to: asOf,
      confidence: 0.95,
      recommended_actions: ACTIONS,
      entity_type: "section",
      entity_id: r.class_section_id,
      entity_label: r.section_label.slice(0, 60), // DB check: entity_label <= 60
      class_section_id: r.class_section_id,
      window: r.version_id,
    });
  });
}

export const timetableConflictsDetector: Detector = {
  key: "timetable-conflicts",
  module: "timetable",
  version: VERSION,
  async run(admin, { institutionId, asOf }) {
    const rows: RoomCapacitySourceRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .rpc("insight_src_room_capacity", { p_institution_id: institutionId, p_as_of: asOf })
        .order("version_id")
        .order("class_section_id") // stable order, or pages can skip/repeat rows
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return detectRoomCapacity(rows, asOf);
  },
};
