import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #19 — demo school labs: 4 labs, 30 equipment rows (3 expired, 5 hazard chemicals), 25 bookings
// across the last and next two weeks, experiments for past bookings, 4 incidents.
// Service-role inserts bypass RLS and the definers, so booked_by/recorded_by/reported_by are set explicitly.
// No rng draws: never shifts another section's PRNG output.

const DAY_MS = 86_400_000;
const isoDay = (offset: number) => new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS + offset * DAY_MS).toISOString().slice(0, 10);
const isSunday = (iso: string) => new Date(Date.parse(iso)).getUTCDay() === 0;

const LABS = [
  { name: "Physics Lab", kind: "science", capacity: 36 },
  { name: "Chemistry Lab", kind: "science", capacity: 32 },
  { name: "Biology Lab", kind: "science", capacity: 32 },
  { name: "Computer Lab", kind: "computer", capacity: 40 },
] as const;

// [lab index, name, kind, quantity, unit, hazard, expiry offset in days (null = none), condition]
type Eq = readonly [number, string, "equipment" | "chemical" | "consumable", number, string, string | null, number | null, string];
const EQUIPMENT: Eq[] = [
  [0, "Vernier calipers", "equipment", 15, "pcs", null, null, "good"],
  [0, "Spring balance", "equipment", 12, "pcs", null, null, "good"],
  [0, "Convex lens set", "equipment", 10, "sets", null, null, "fair"],
  [0, "Laser pointer", "equipment", 4, "pcs", null, null, "good"],
  [0, "Digital multimeter", "equipment", 8, "pcs", null, null, "needs_repair"],
  [0, "Tuning fork set", "equipment", 0, "sets", null, null, "out_of_service"],
  [0, "Dry cell batteries", "consumable", 40, "pcs", null, 200, "good"],
  [1, "Hydrochloric acid", "chemical", 2000, "ml", "corrosive", 180, "good"],
  [1, "Sulphuric acid", "chemical", 1500, "ml", "corrosive", -30, "good"],
  [1, "Sodium hydroxide", "chemical", 800, "g", "corrosive", 300, "good"],
  [1, "Ethanol", "chemical", 3000, "ml", "flammable", 90, "good"],
  [1, "Potassium permanganate", "chemical", 250, "g", "oxidising", -10, "good"],
  [1, "Phenolphthalein", "chemical", 100, "ml", null, 365, "good"],
  [1, "Bunsen burners", "equipment", 14, "pcs", null, null, "good"],
  [1, "Test tubes", "consumable", 120, "pcs", null, null, "good"],
  [1, "Litmus paper", "consumable", 3, "packs", null, 60, "good"],
  [2, "Compound microscopes", "equipment", 12, "pcs", null, null, "good"],
  [2, "Prepared slides", "consumable", 60, "pcs", null, null, "good"],
  [2, "Formalin", "chemical", 500, "ml", "toxic", -100, "good"],
  [2, "Methylene blue", "chemical", 120, "ml", "irritant", 150, "good"],
  [2, "Dissection kits", "equipment", 10, "kits", null, null, "fair"],
  [2, "Petri dishes", "consumable", 0, "pcs", null, null, "good"],
  [2, "Stethoscope", "equipment", 2, "pcs", null, null, "good"],
  [3, "Desktop computers", "equipment", 38, "pcs", null, null, "good"],
  [3, "Network switch", "equipment", 2, "pcs", null, null, "good"],
  [3, "Projector", "equipment", 1, "pcs", null, null, "needs_repair"],
  [3, "Headphones", "equipment", 20, "pcs", null, null, "fair"],
  [3, "Printer toner", "consumable", 1, "pcs", null, 120, "good"],
  [3, "Arduino kits", "equipment", 10, "kits", null, null, "good"],
  [3, "Compressed air can", "consumable", 6, "pcs", "compressed_gas", 400, "good"],
];

const EXPERIMENTS = ["Ohm's law verification", "Titration of acid and base", "Onion peel slide study", "Focal length of a convex lens", "Rate of reaction", "Python loops practical", "Osmosis in potato", "Simple pendulum"];

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const adminUserId = ctx.userIdByLogin["admin"]!;
  const ids = (what: string, r: { data: { id: string }[] | null; error: { message: string } | null }) => {
    if (r.error) throw new Error(`school-labs: ${what} query failed: ${r.error.message}`);
    return (r.data ?? []).map((x) => x.id);
  };
  const periodIds = ids("periods", await ctx.admin.from("periods").select("id").eq("institution_id", inst).eq("is_break", false).order("seq"));
  const sectionIds = ids("class_sections", await ctx.admin.from("class_sections").select("id").eq("institution_id", inst).order("id").limit(12));
  const subjectIds = ids("subjects", await ctx.admin.from("subjects").select("id").eq("institution_id", inst).order("id").limit(12));
  const staffIds = [...ctx.teacherStaffIds].sort();
  if (periodIds.length === 0 || sectionIds.length === 0 || subjectIds.length === 0 || staffIds.length === 0) return;

  const labs = LABS.map((l, i) => ({ id: uuidV5("school-lab", `${inst}:${i}`), institution_id: inst, ...l }));
  await insertBatch(ctx.admin, "school_labs", labs);

  await insertBatch(
    ctx.admin,
    "school_lab_equipment",
    EQUIPMENT.map(([li, name, kind, quantity, unit, hazard, exp, condition], i) => ({
      id: uuidV5("school-lab-equipment", `${inst}:${i}`),
      institution_id: inst,
      lab_id: labs[li]!.id,
      name,
      kind,
      quantity,
      unit,
      hazard_class: hazard,
      expiry_on: exp === null ? null : isoDay(exp),
      condition,
    })),
  );

  // Bookings: 25 spread over -14..+14 days, Sundays skipped; both unique indexes (lab and teacher per date+period) respected.
  const taken = new Set<string>();
  const bookings: Record<string, unknown>[] = [];
  for (let i = 0; i < 25; i++) {
    let date = isoDay(-14 + Math.floor((i * 28) / 25));
    if (isSunday(date)) date = isoDay(-14 + Math.floor((i * 28) / 25) + 1);
    const lab = labs[i % labs.length]!;
    const staffId = staffIds[(i * 7) % staffIds.length]!;
    let p = (i * 3) % periodIds.length;
    for (let tries = 0; tries < periodIds.length; tries++, p = (p + 1) % periodIds.length) {
      if (!taken.has(`l:${lab.id}:${date}:${p}`) && !taken.has(`s:${staffId}:${date}:${p}`)) break;
    }
    const cancelled = i % 11 === 5;
    if (!cancelled) {
      taken.add(`l:${lab.id}:${date}:${p}`);
      taken.add(`s:${staffId}:${date}:${p}`);
    }
    bookings.push({
      id: uuidV5("school-lab-booking", `${inst}:${i}`),
      institution_id: inst,
      lab_id: lab.id,
      class_section_id: sectionIds[i % sectionIds.length],
      subject_id: subjectIds[(i * 5) % subjectIds.length],
      staff_id: staffId,
      date,
      period_id: periodIds[p],
      purpose: EXPERIMENTS[i % EXPERIMENTS.length],
      status: cancelled ? "cancelled" : "booked",
      booked_by: adminUserId,
      cancelled_at: cancelled ? new Date().toISOString() : null,
      cancelled_by: cancelled ? adminUserId : null,
    });
  }
  await insertBatch(ctx.admin, "school_lab_bookings", bookings);

  const today = isoDay(0);
  const past = bookings.filter((b) => b.status === "booked" && (b.date as string) < today);
  await insertBatch(
    ctx.admin,
    "school_lab_experiments",
    past.map((b, i) => ({
      id: uuidV5("school-lab-experiment", `${b.id}`),
      institution_id: inst,
      booking_id: b.id,
      title: EXPERIMENTS[i % EXPERIMENTS.length],
      notes: i % 2 === 0 ? "Groups of four; results noted in the practical file." : null,
      completed: i % 3 !== 0,
      recorded_by: adminUserId,
    })),
  );

  const incidentDefs = [
    ["breakage", "low", "Two test tubes broke during heating.", 12000],
    ["breakage", "medium", "A microscope lens cracked when dropped.", 450000],
    ["safety", "medium", "Acid spill on a bench; cleaned with neutraliser, no injury.", null],
    ["safety", "high", "Burner left on after class; caught by the lab assistant.", null],
  ] as const;
  await insertBatch(
    ctx.admin,
    "school_lab_incidents",
    incidentDefs.map(([kind, severity, description, cost], i) => {
      const b = past[i % Math.max(past.length, 1)];
      return {
        id: uuidV5("school-lab-incident", `${inst}:${i}`),
        institution_id: inst,
        lab_id: b ? b.lab_id : labs[0]!.id,
        booking_id: b ? b.id : null,
        kind,
        severity,
        description,
        cost_paise: cost,
        reported_by: adminUserId,
      };
    }),
  );
}
