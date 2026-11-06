// Pure builder for the dashboard approvals queue: unions the generic approvals
// union (staff leave, rechecks, insights, agent runs) with pending student leave.
import type { ApprovalRow } from "@/components/widgets/approvals-widget";
import type { StudentLeaveRow } from "@/modules/student-leave/queries";

export type ApprovalKind = "staff_leave" | "student_leave" | "link";

export interface ApprovalQueueItem {
  id: string;
  kind: ApprovalKind;
  /** Short category label shown above the title. */
  category: string;
  title: string;
  who: string;
  age: string;
  /** Present for items decided elsewhere (recheck, insight, agent run). */
  href?: string;
}

const CATEGORY: Record<string, string> = { recheck: "Recheck", insight: "Insight", agent_run: "Agent run" };

export function ageLabel(createdAtIso: string, nowMs: number): string {
  const hours = Math.max(0, Math.round((nowMs - Date.parse(createdAtIso)) / 3_600_000));
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

export function buildApprovalQueue(
  approvals: ApprovalRow[],
  studentLeaves: StudentLeaveRow[],
  nowMs: number,
  limit = 8,
): { items: ApprovalQueueItem[]; total: number } {
  const items: ApprovalQueueItem[] = [
    ...approvals.map((a): ApprovalQueueItem =>
      a.kind === "leave"
        ? { id: a.id, kind: "staff_leave", category: "Staff leave", title: a.title, who: a.requestedBy, age: a.age }
        : { id: a.id, kind: "link", category: CATEGORY[a.kind] ?? a.kind, title: a.title, who: a.requestedBy, age: a.age, href: a.href },
    ),
    ...studentLeaves
      .filter((l) => l.status === "pending")
      .map(
        (l): ApprovalQueueItem => ({
          id: l.id,
          kind: "student_leave",
          category: "Student leave",
          title: `${l.days} day${l.days === 1 ? "" : "s"} from ${l.startDate}: ${l.reason}`,
          who: `${l.studentName} (${l.classSection})`,
          age: ageLabel(l.createdAt, nowMs),
        }),
      ),
  ];
  return { items: items.slice(0, limit), total: items.length };
}
