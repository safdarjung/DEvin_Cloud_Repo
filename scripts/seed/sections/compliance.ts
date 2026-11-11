import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #22 — demo compliance tracker: 18 items, a renewal history on the older ones.
// Dates are fixed around the demo date (2026-11-11) so overdue / due soon / ok all show. Deterministic, no rng draws.
// due_on = the latest event's new_due_on when an item has events (0130: only renewals move it).
type Cat = "affiliation" | "safety" | "transport" | "staff" | "financial" | "other";
// [title, category, authority, due_on, renewEveryMonths, renewals: [renewed_on, new_due_on][]]
const ITEMS: [string, Cat, string | null, string, number | null, [string, string][]][] = [
  ["Board affiliation", "affiliation", "Affiliating board", "2028-03-31", 36, [["2025-03-20", "2028-03-31"]]],
  ["Fire NOC", "safety", "Fire department", "2026-11-25", 12, [["2025-11-20", "2026-11-25"]]],
  ["Building safety certificate", "safety", "Municipal engineer", "2027-06-30", 24, [["2025-06-18", "2027-06-30"]]],
  ["Electrical safety inspection", "safety", null, "2026-12-05", 12, [["2025-12-01", "2026-12-05"]]],
  ["Drinking-water test", "safety", "Accredited lab", "2026-10-20", 6, [["2026-04-15", "2026-10-20"]]],
  ["Lift inspection", "safety", null, "2027-02-14", 12, []],
  ["Bus 1 fitness certificate", "transport", "Transport office", "2026-11-18", 12, [["2025-11-10", "2026-11-18"]]],
  ["Bus 2 fitness certificate", "transport", "Transport office", "2027-01-22", 12, [["2026-01-15", "2027-01-22"]]],
  ["Bus 1 insurance", "transport", null, "2026-12-30", 12, [["2025-12-28", "2026-12-30"]]],
  ["Bus 2 insurance", "transport", null, "2027-03-10", 12, []],
  ["Bus permit", "transport", "Transport office", "2027-09-01", 60, []],
  ["Driver licence checks", "transport", null, "2026-10-31", 12, [["2025-10-28", "2026-10-31"]]],
  ["Staff police verification", "staff", "Local police", "2027-04-30", 36, [["2024-04-25", "2027-04-30"]]],
  ["Staff first-aid refresher", "staff", null, "2026-11-30", 12, []],
  ["Society or trust audit", "financial", "Chartered accountant", "2027-07-31", 12, [["2026-07-20", "2027-07-31"]]],
  ["Professional tax filing", "financial", null, "2026-11-30", 1, [["2026-10-28", "2026-11-30"]]],
  ["Provident fund return", "financial", null, "2026-11-15", 1, [["2026-10-12", "2026-11-15"]]],
  ["Library membership affiliation", "other", null, "2027-05-31", 12, []],
];

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const adminUserId = ctx.userIdByLogin["admin"]!;
  const ownerStaff = ctx.teacherStaffIds.slice(0, 3);
  const items = ITEMS.map(([title, category, authority, due_on, renew_every_months], i) => ({
    id: uuidV5("compliance-item", `${inst}:${i}`),
    institution_id: inst,
    title,
    category,
    authority,
    due_on,
    renew_every_months,
    owner_staff_id: i % 3 === 0 ? ownerStaff[(i / 3) % ownerStaff.length] ?? null : null,
  }));
  await insertBatch(ctx.admin, "compliance_items", items);

  const events = ITEMS.flatMap(([, , , , , renewals], i) =>
    renewals.map(([renewed_on, new_due_on], ei) => ({
      id: uuidV5("compliance-event", `${inst}:${i}:${ei}`),
      institution_id: inst,
      item_id: items[i]!.id,
      renewed_on,
      new_due_on,
      note: "Renewed on time",
      recorded_by: adminUserId,
      created_at: `${renewed_on}T10:00:00+05:30`,
    })),
  );
  await insertBatch(ctx.admin, "compliance_events", events);
}
