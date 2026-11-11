import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #11 — demo inventory: 24 items, ~3 movements each. Deterministic, no rng draws.
// Movement sign rules (migration 0120): in/return > 0, issue < 0. Totals never go below zero.
const ITEMS: [string, string, number][] = [
  ["Chalk sticks", "box", 10], ["Whiteboard markers", "pcs", 20], ["Duster", "pcs", 5], ["A4 paper", "ream", 15],
  ["Notebooks", "pcs", 100], ["Pencils", "pcs", 150], ["Ball pens (blue)", "pcs", 100], ["Staplers", "pcs", 3],
  ["Stapler pins", "box", 10], ["Glue sticks", "pcs", 30], ["Chart paper", "sheet", 50], ["Crayons", "box", 20],
  ["Register books", "pcs", 10], ["Phenyl", "litre", 10], ["Hand wash", "litre", 8], ["Toilet rolls", "pack", 12],
  ["First-aid bandages", "pack", 5], ["Sports cones", "pcs", 10], ["Footballs", "pcs", 3], ["Badminton shuttles", "tube", 4],
  ["Printer toner", "pcs", 2], ["Extension boards", "pcs", 3], ["Light bulbs", "pcs", 10], ["ID card lanyards", "pcs", 50],
];

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const adminUserId = ctx.userIdByLogin["admin"]!;
  const items = ITEMS.map(([name, unit, reorder_level], i) => ({
    id: uuidV5("inventory-item", `${inst}:${i}`),
    institution_id: inst,
    name,
    unit,
    reorder_level,
    is_active: true,
  }));
  await insertBatch(ctx.admin, "inventory_items", items);

  const day = (n: number) => `2026-10-${String(1 + n).padStart(2, "0")}T09:00:00+05:30`;
  const movements = items.flatMap((it, i) => {
    const reorder = ITEMS[i]![2];
    const received = reorder * 3 + 7 + (i % 5);
    // Every 6th item ends below reorder level so the low-stock view has rows.
    const issued = i % 6 === 0 ? received - Math.max(0, reorder - 1) : Math.floor(received / 3);
    return [
      { kind: "in", quantity: received, note: "Opening purchase", at: day(0) },
      { kind: "issue", quantity: -issued, note: "Issued to classrooms", at: day(10 + (i % 10)) },
      ...(i % 4 === 1 ? [{ kind: "return", quantity: 2, note: "Returned unused", at: day(20) }] : []),
    ].map((m, mi) => ({
      id: uuidV5("inventory-movement", `${inst}:${i}:${mi}`),
      institution_id: inst,
      item_id: it.id,
      kind: m.kind,
      quantity: m.quantity,
      note: m.note,
      recorded_by: adminUserId,
      created_at: m.at,
    }));
  });
  await insertBatch(ctx.admin, "inventory_movements", movements);
}
