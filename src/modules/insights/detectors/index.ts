// M19-T14 — detector registry, Signals-table file order (rulings "Detection
// pipeline" > Detector, Signals table). Relative `.ts` value imports:
// `pnpm jobs:run` loads this file as plain node.
import { attendanceDetector } from "./attendance.ts";
import { marksDetector } from "./marks.ts";
import { submissionsDetector } from "./submissions.ts";
import { feesDetector } from "./fees.ts";
import { admissionsDetector } from "./admissions.ts";
import { workloadDetector } from "./workload.ts";
import { timetableConflictsDetector } from "./timetable-conflicts.ts";
import { resourceShortageDetector } from "./resource-shortage.ts";
import type { Detector } from "../signals.ts";

export const DETECTORS: readonly Detector[] = [
  attendanceDetector,
  marksDetector,
  submissionsDetector,
  feesDetector,
  admissionsDetector,
  workloadDetector,
  timetableConflictsDetector,
  resourceShortageDetector,
];
