import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { asUser, demoUsers, insertOnce, isoAt } from "../lib/util.ts";

// Simulation scenarios (what-if planner) and Studio requests (custom-build intake).
// Scenarios: inserted in their final state (the guard trusts service-role inserts).
// Studio requests: the guard forces every insert to `submitted`, so they are moved on
// through the real propose/decide RPCs as the principal. `in_progress`/`delivered` are
// allowed by the CHECK but no guarded transition reaches them, so none are seeded.

const SCENARIOS = [
  { key: "add-section", name: "Add a second section to Grade VI", rationale: "Grade VI admissions are 18% above capacity; a new section needs two teachers and a room.", status: "approved", a: [12, 2, 0, 6, 8, 12] },
  { key: "fee-hike", name: "Fee revision of 8% from April", rationale: "Staff costs rose 9% after the pay revision; test the effect on collections and enrolment.", status: "proposed", a: [-2, 0, 8, 7, 8, 12] },
  { key: "nine-periods", name: "Nine-period day for Grades IX-X", rationale: "Board prep needs extra lab and revision periods without lengthening the school day.", status: "rejected", a: [0, 1, 0, 3, 9, 6] },
  { key: "hostel-wing", name: "Open girls' hostel wing", rationale: "Outstation applicants for Grade XI are being turned away; model demand against the added cost.", status: "proposed", a: [6, 3, 4, 12, 8, 24] },
  { key: "lean-year", name: "Lean year: freeze hiring", rationale: "Worst case if enrolment dips 5% after the new school opens nearby.", status: "draft", a: [-5, 0, 0, -2, 8, 12] },
  { key: "evening-batch", name: "Evening remedial batch", rationale: "One extra period of remedial classes for weak scorers; needs three part-time teachers.", status: "draft", a: [0, 3, 2, 4, 7, 9] },
] as const;

const REQUESTS = [
  { key: "alumni-portal", title: "Alumni donation portal", problem: "We collect alumni donations by cheque and WhatsApp screenshots and cannot reconcile them.", outcome: "Alumni can pledge and pay online and the office sees a clean ledger.", budget: "50k_2l", timeline: "10 weeks", final: "approved", resolution: "new_module", weeks: 9, cost: 18500000 },
  { key: "bus-tracking", title: "Live school bus tracking", problem: "Parents call the office every afternoon to ask where the bus is.", outcome: "Guardians see bus position and ETA on the app.", budget: "2l_10l", timeline: "4 months", final: "rejected", resolution: "integration", weeks: 16, cost: 62000000 },
  { key: "uniform-store", title: "Uniform and book store counter", problem: "Uniform sales are in a paper register and stock runs out without warning.", outcome: "Counter billing with stock alerts.", budget: "under_50k", timeline: "6 weeks", final: "approved", resolution: "combine_modules", weeks: 5, cost: 4500000 },
  { key: "scholar-ranks", title: "Merit list by subject for scholarships", problem: "Scholarship merit lists are built by hand from exam sheets.", outcome: "One click merit list by grade and subject.", budget: "under_50k", timeline: "3 weeks", final: "proposed", resolution: "configuration", weeks: 2, cost: 1200000 },
  { key: "ptm-feedback", title: "Post-PTM feedback form", problem: "We get no structured feedback from parents after PTM day.", outcome: "A 5-question form sent after every PTM with a summary for the principal.", budget: "under_50k", timeline: "2 weeks", final: "proposed", resolution: "existing_feature", weeks: 1, cost: 0 },
  { key: "tally-export", title: "Tally export for accountant", problem: "The accountant re-types fee receipts into Tally every month.", outcome: "A monthly voucher file Tally can import.", budget: "50k_2l", timeline: "6 weeks", final: "proposed", resolution: "integration", weeks: 6, cost: 9000000 },
  { key: "library-kiosk", title: "Self-service library kiosk", problem: "Library issue and return queues are long during lunch break.", outcome: "Students scan their ID and book to self-issue.", budget: "50k_2l", timeline: "8 weeks", final: "submitted" },
  { key: "sports-day", title: "Sports day house points", problem: "House points are tallied on a whiteboard and disputed.", outcome: "Live house leaderboard during sports day.", budget: "under_50k", timeline: "3 weeks", final: "submitted" },
  { key: "hindi-circulars", title: "Hindi and Marathi circulars", problem: "Many guardians cannot read English circulars.", outcome: "Announcements go out in the guardian's language.", budget: "unknown", timeline: "Before next term", final: "submitted" },
  { key: "canteen-prepaid", title: "Prepaid canteen wallets", problem: "Children carry cash to the canteen and lose it.", outcome: "Prepaid wallet topped up by guardians, with daily limits.", budget: "2l_10l", timeline: "3 months", final: "approved", resolution: "new_module", weeks: 12, cost: 38000000 },
] as const;

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const users = await demoUsers(ctx.sql, inst);
  const principal = users["principal"]!;
  const admin = users["admin"]!;
  const accountant = users["accountant"]!;

  const scenarioRows = SCENARIOS.map((s, i) => {
    const [enrol, staff, fee, cost, periods, horizon] = s.a;
    const decided = s.status === "approved" || s.status === "rejected";
    return {
      id: uuidV5("fabric-studio", `scenario:${s.key}`),
      institution_id: inst,
      name: s.name,
      rationale: s.rationale,
      assumptions: { enrolment_delta_pct: enrol, staff_delta: staff, fee_change_pct: fee, cost_change_pct: cost, periods_per_day: periods, horizon_months: horizon },
      status: s.status,
      created_by: i % 2 === 0 ? admin : principal,
      decided_by: decided ? principal : null,
      decided_at: decided ? isoAt(-(20 - i * 3), 11) : null,
      created_at: isoAt(-(26 - i * 3), 10),
    };
  });
  await insertOnce(ctx.admin, "simulation_scenarios", scenarioRows);

  const requestRows = REQUESTS.map((r, i) => ({
    id: uuidV5("fabric-studio", `request:${r.key}`),
    institution_id: inst,
    title: r.title,
    problem: r.problem,
    desired_outcome: r.outcome,
    context: { userRoles: ["admin", "accountant"], existingSystems: ["Excel", "WhatsApp"], integrations: [], constraints: "" },
    terms: { budgetRange: r.budget, timeline: r.timeline, successCriteria: "Office staff use it daily without help." },
    created_by: [admin, accountant, principal][i % 3]!,
    created_at: isoAt(-(28 - i * 2), 9 + (i % 5)),
  }));
  await insertOnce(ctx.admin, "studio_requests", requestRows);
  // Only requests still `submitted` are moved on, so a rerun never re-proposes or re-decides.
  const submitted = new Set(
    (await ctx.sql<{ id: string }[]>`select id from public.studio_requests where institution_id = ${inst} and status = 'submitted'`).map((r) => r.id),
  );

  for (const r of REQUESTS) {
    const id = uuidV5("fabric-studio", `request:${r.key}`);
    if (!submitted.has(id) || r.final === "submitted") continue;
    const proposal = {
      resolution: r.resolution,
      interpretation: `${r.title}: ${r.outcome}`,
      clarifyingQuestions: [],
      features: [r.outcome, "Role-based access for office staff", "Export to CSV for the accountant"],
      workflows: [],
      uxOutline: [],
      technicalRequirements: [],
      integrationRequirements: [],
      permissionRequirements: [],
      costEstimatePaise: r.cost,
      timelineWeeks: r.weeks,
      risks: [],
      acceptanceCriteria: ["Works on seeded demo data", "Reviewed by the principal"],
    };
    await asUser(ctx.sql, principal, async (tx) => {
      await tx`select public.propose_studio_request(${id}::uuid, ${tx.json(proposal)}::jsonb)`;
      if (r.final === "approved") await tx`select public.decide_studio_request(${id}::uuid, 'approve', 'Approved for the next build cycle.')`;
      if (r.final === "rejected") await tx`select public.decide_studio_request(${id}::uuid, 'reject', 'Too costly for this year; revisit with the transport vendor.')`;
    });
  }
}
