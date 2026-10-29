import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { GRADES } from "../lib/grades.ts";
import { uuidV5 } from "../lib/ids.ts";
import { FIRST_NAMES_FEMALE, FIRST_NAMES_MALE, LAST_NAMES, pickName } from "../lib/names.ts";

// 05 §8 / §8.1 (mandatory demo-data contract) — 40 enquiries (12 new, 10
// contacted, 6 visit_scheduled, 5 application_sent, 4 converted, 3 closed)
// and 8 applications (submitted 2, under_review 2, interaction_scheduled 1,
// offered 1, accepted 2). The contract's 4 "converted" enquiries each
// produce one linked application (submitted/under_review/
// interaction_scheduled/offered, one each); the remaining 4 applications
// are walk-ins with no enquiry_id — APP-live-1 and APP-live-2 (both
// accepted, reserved for J-05's live enrolment) plus one submitted and one
// under_review walk-in. 05 §8.2: "seed writes rows directly... through the
// same constraints and triggers" — status is set directly on INSERT (the
// guard triggers on these tables are BEFORE UPDATE only, so a fresh INSERT
// at any status is never blocked).

const ANCHOR_DATE = "2026-10-28"; // same "today" convention as attendance.ts (J-06)
const ENQUIRY_WINDOW_DAYS = 45;

const STAGE_COUNTS: { status: string; count: number }[] = [
  { status: "new", count: 12 },
  { status: "contacted", count: 10 },
  { status: "visit_scheduled", count: 6 },
  { status: "application_sent", count: 5 },
  { status: "converted", count: 4 },
  { status: "closed", count: 3 },
];

const SOURCE_COUNTS: { source: string; count: number }[] = [
  { source: "website", count: 18 },
  { source: "walk_in", count: 10 },
  { source: "phone", count: 8 },
  { source: "referral", count: 4 },
];

const PREFERRED_GRADE_CODES = ["I", "VI", "IX", "XI"];

function expand<T extends { count: number }>(buckets: T[]): T[] {
  return buckets.flatMap((b) => Array.from({ length: b.count }, () => b));
}

function daysAgo(anchor: string, days: number): string {
  const d = new Date(`${anchor}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function gradeIdFor(code: string): string {
  return uuidV5("academics", `grade:${code}`);
}

/** A guardian's first name drawn from the same pools as the rest of the seed, paired with the child's surname (same convention as people.ts's generic families). */
function guardianFirstName(rng: () => number): string {
  const pool = rng() < 0.5 ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE;
  return pool[Math.floor(rng() * pool.length)]!;
}

export async function run(ctx: SeedContext): Promise<void> {
  const { data: existing } = await ctx.admin
    .from("enquiries")
    .select("id")
    .eq("institution_id", ctx.institutionId)
    .limit(1)
    .maybeSingle();
  if (existing) return; // idempotent rerun guard

  const admissionsStaffId = ctx.linkIdByLogin["admissions"];
  const admissionsUserId = ctx.userIdByLogin["admissions"];

  const stages = expand(STAGE_COUNTS).map((b) => b.status);
  const sources = expand(SOURCE_COUNTS).map((b) => b.source);

  const enquiryRows: Record<string, unknown>[] = [];
  const enquiryIds: string[] = [];
  const convertedEnquiryIndices: number[] = [];

  for (let i = 0; i < 40; i++) {
    const status = stages[i]!;
    const source = sources[i]!;
    if (status === "converted") convertedEnquiryIndices.push(i);

    const isMale = ctx.rng() < 0.5;
    const { firstName: childFirst } = pickName(ctx.rng, isMale ? "male" : "female");
    const childLast = LAST_NAMES[Math.floor(ctx.rng() * LAST_NAMES.length)]!;
    const { firstName: guardianFirst } = pickName(ctx.rng, ctx.rng() < 0.5 ? "male" : "female");
    const gradeCode =
      ctx.rng() < 0.7
        ? PREFERRED_GRADE_CODES[i % PREFERRED_GRADE_CODES.length]!
        : GRADES[Math.floor(ctx.rng() * GRADES.length)]!.code;

    const createdOn = daysAgo(ANCHOR_DATE, Math.floor(ctx.rng() * ENQUIRY_WINDOW_DAYS));
    const id = uuidV5("admissions", `enquiry:${i}`);
    enquiryIds.push(id);

    const noteCount = 1 + Math.floor(ctx.rng() * 3);
    const notes = Array.from({ length: noteCount }, (_, n) => ({
      author: admissionsUserId ?? null,
      at: `${createdOn}T${String(10 + n).padStart(2, "0")}:00:00+05:30`,
      text: n === 0 ? `Enquiry logged via ${source.replace("_", " ")}.` : `Follow-up ${n}: stage is ${status}.`,
    }));

    enquiryRows.push({
      id,
      institution_id: ctx.institutionId,
      child_name: `${childFirst} ${childLast}`,
      grade_applied_id: gradeIdFor(gradeCode),
      guardian_name: `${guardianFirst} ${childLast}`,
      phone: `98000002${String(i).padStart(2, "0")}`,
      source,
      status,
      assigned_to: ctx.rng() < 0.6 ? admissionsStaffId : null,
      notes,
      created_at: `${createdOn}T09:00:00+05:30`,
    });
  }

  await insertBatch(ctx.admin, "enquiries", enquiryRows);

  // ---- applications (05 §8.1) ----
  const appRows: Record<string, unknown>[] = [];
  const decisionRows: Record<string, unknown>[] = [];

  const linkedStates = ["submitted", "under_review", "interaction_scheduled", "offered"];
  convertedEnquiryIndices.forEach((enquiryIndex, i) => {
    const status = linkedStates[i]!;
    const appId = uuidV5("admissions", `application:linked:${i}`);
    const { firstName, lastName } = pickName(ctx.rng, ctx.rng() < 0.5 ? "male" : "female");
    appRows.push({
      id: appId,
      institution_id: ctx.institutionId,
      enquiry_id: enquiryIds[enquiryIndex],
      applicant: { firstName, lastName, dob: "2017-06-15", gender: FIRST_NAMES_MALE.includes(firstName) ? "male" : "female" },
      guardian: { fullName: `${guardianFirstName(ctx.rng)} ${lastName}`, phone: `98000003${String(i).padStart(2, "0")}`, email: null, relationship: "father" },
      grade_applied_id: gradeIdFor(PREFERRED_GRADE_CODES[i % PREFERRED_GRADE_CODES.length]!),
      academic_year_id: ctx.academicYearId,
      status,
    });
    if (status === "offered") {
      decisionRows.push({
        id: uuidV5("admissions", `decision:linked-offer:${i}`),
        institution_id: ctx.institutionId,
        application_id: appId,
        decision: "offer",
        decided_by: admissionsUserId,
      });
    }
  });

  // APP-live-1: Riya Verma, grade I, accepted, new guardian Sunita Verma 9800000101 (05 §8.1).
  const appLive1Id = uuidV5("admissions", "application:APP-live-1");
  appRows.push({
    id: appLive1Id,
    institution_id: ctx.institutionId,
    enquiry_id: null,
    applicant: { firstName: "Riya", lastName: "Verma", dob: "2020-05-10", gender: "female" },
    guardian: { fullName: "Sunita Verma", phone: "9800000101", email: null, relationship: "mother" },
    grade_applied_id: gradeIdFor("I"),
    academic_year_id: ctx.academicYearId,
    status: "accepted",
  });

  // APP-live-2: Kabir Mehta, grade VI, accepted, guardian phone reuses
  // guardian.two (9800000002) to demonstrate C-21 guardian reuse at J-05.
  const appLive2Id = uuidV5("admissions", "application:APP-live-2");
  appRows.push({
    id: appLive2Id,
    institution_id: ctx.institutionId,
    enquiry_id: null,
    applicant: { firstName: "Kabir", lastName: "Mehta", dob: "2015-08-22", gender: "male" },
    guardian: { fullName: "Rohit Mehta", phone: "9800000002", email: null, relationship: "father" },
    grade_applied_id: gradeIdFor("VI"),
    academic_year_id: ctx.academicYearId,
    status: "accepted",
  });

  for (const [appId, label] of [
    [appLive1Id, "APP-live-1"],
    [appLive2Id, "APP-live-2"],
  ] as const) {
    decisionRows.push(
      {
        id: uuidV5("admissions", `decision:${label}:offer`),
        institution_id: ctx.institutionId,
        application_id: appId,
        decision: "offer",
        decided_by: admissionsUserId,
      },
      {
        id: uuidV5("admissions", `decision:${label}:accept`),
        institution_id: ctx.institutionId,
        application_id: appId,
        decision: "accept",
        decided_by: admissionsUserId,
      },
    );
  }

  // Two more walk-in applications (no enquiry_id): submitted, under_review.
  const WALK_INS = [
    { key: "walk-in-3", status: "submitted", gradeCode: "IX", phoneSuffix: "01" },
    { key: "walk-in-4", status: "under_review", gradeCode: "XI", phoneSuffix: "02" },
  ] as const;
  for (const walkIn of WALK_INS) {
    const { firstName, lastName } = pickName(ctx.rng, ctx.rng() < 0.5 ? "male" : "female");
    appRows.push({
      id: uuidV5("admissions", `application:${walkIn.key}`),
      institution_id: ctx.institutionId,
      enquiry_id: null,
      applicant: { firstName, lastName, dob: "2018-01-01", gender: FIRST_NAMES_FEMALE.includes(firstName) ? "female" : "male" },
      guardian: { fullName: `${guardianFirstName(ctx.rng)} ${lastName}`, phone: `98000004${walkIn.phoneSuffix}`, email: null, relationship: "mother" },
      grade_applied_id: gradeIdFor(walkIn.gradeCode),
      academic_year_id: ctx.academicYearId,
      status: walkIn.status,
    });
  }

  await insertBatch(ctx.admin, "applications", appRows);
  await insertBatch(ctx.admin, "application_decisions", decisionRows);
}
