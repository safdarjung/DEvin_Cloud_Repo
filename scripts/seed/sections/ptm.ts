import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { sectionKey, sectionNames } from "../lib/grades.ts";
import { uuidV5 } from "../lib/ids.ts";

// X08-T10 (X08-tasks.md Task 10) — one published PTM event ("Term 2 PTM",
// 2026-11-21, 09:00-13:00, 10-min slots -> seq 0-23) with every grade
// VI-X section, one slot series per that section's class teacher, ~40% of
// each teacher's slots booked (named exceptions: Aarav booked at seq 6/
// 10:00 with teacher.vi-a; Ananya and Ishaan left unbooked for the live
// demo). Plus one open, anonymous "Term 1 parent feedback" survey (school
// audience, 4 questions) with 60 responses from seeded guardians
// (guardian.one/guardian.two excluded — they respond live).
//
// Everything here is inserted as service-role INSERTs of the final
// (published/open) state: guard_ptm_events_update only fires on UPDATE,
// and guard_surveys_write's INSERT branch only validates the `questions`
// shape (not the draft-only status), so neither guard rejects these rows
// (header rulings / T2-T3 reports).

const PTM_GRADE_CODES = ["VI", "VII", "VIII", "IX", "X"] as const;
const EVENT_TITLE = "Term 2 PTM";
const EVENT_DATE = "2026-11-21"; // Saturday, M13's seeded calendar PTM date.
const DAY_STARTS_AT = "09:00";
const DAY_ENDS_AT = "13:00";
const SLOT_MINUTES = 10;
const SLOT_COUNT = 24; // (13:00 - 09:00) / 10 minutes.
const BOOKING_CLOSES_AT = "2026-11-20T18:00:00+05:30";
const PUBLISHED_AT = "2026-11-05T09:00:00+05:30"; // fixed, not wall-clock (05 §8 determinism).
const BOOKING_FRACTION = 0.4;

const SURVEY_TITLE = "Term 1 parent feedback";
const SURVEY_CLOSES_AT = "2026-11-30T23:59:00+05:30";
const SURVEY_OPENED_AT = "2026-10-01T09:00:00+05:30";
const SURVEY_RESPONSE_STAMP = "2026-11-01T00:00:00+05:30";
const SURVEY_RESPONDENT_COUNT = 60;
const SURVEY_ACTOR_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

const SURVEY_QUESTIONS = [
  {
    type: "single",
    prompt: "How satisfied are you with the school this term?",
    options: ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"],
  },
  {
    type: "multi",
    prompt: "What should we improve?",
    options: ["Communication", "Academics", "Extracurriculars", "Facilities", "Discipline"],
  },
  { type: "text", prompt: "Any other suggestions?" },
  { type: "single", prompt: "Would you recommend this school to other parents?", options: ["Yes", "No"] },
] as const;

const SURVEY_TEXT_SUGGESTIONS = [
  "",
  "More extracurricular activities please.",
  "Would like more frequent progress updates.",
  "Canteen food quality could improve.",
  "Great term overall, thank you.",
];

/** Picks `n` distinct items from `items` using `rng`, without replacement (order of draws deterministic given a fixed rng). */
function pickRandomDistinct<T>(rng: () => number, items: readonly T[], n: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

function randomSurveyAnswers(rng: () => number): unknown[] {
  const satisfaction = Math.floor(rng() * 5);
  const improveCount = 1 + Math.floor(rng() * 3); // 1-3 of the 5 options
  const improve = pickRandomDistinct(rng, [0, 1, 2, 3, 4], improveCount).sort((a, b) => a - b);
  const suggestion = SURVEY_TEXT_SUGGESTIONS[Math.floor(rng() * SURVEY_TEXT_SUGGESTIONS.length)]!;
  const recommend = Math.floor(rng() * 2);
  return [satisfaction, improve, suggestion, recommend];
}

/**
 * Gives 60 already-seeded, non-named guardians a real login (shortcut:
 * reused as both survey respondents and, round-robin, PTM booking actors
 * below — creating a distinct auth user per booking would mean ~300+ new
 * auth users per reseed; upgrade if the demo script ever needs each
 * booking/response tied to its student's actual guardian). Reruns are
 * idempotent: createUser's "already registered" path looks the existing
 * user up instead of failing (same pattern as sections/core.ts).
 */
async function ensureSurveyActors(ctx: SeedContext): Promise<string[]> {
  const excludeIds = new Set(
    [ctx.linkIdByLogin["guardian.one"], ctx.linkIdByLogin["guardian.two"]].filter((id): id is string => !!id),
  );

  const { data: candidates, error } = await ctx.admin
    .from("guardians")
    .select("id, full_name")
    .eq("institution_id", ctx.institutionId)
    .order("id")
    .limit(SURVEY_RESPONDENT_COUNT + 10);
  if (error) throw new Error(`ptm: guardians query failed: ${error.message}`);

  const picked = (candidates ?? []).filter((g) => !excludeIds.has(g.id)).slice(0, SURVEY_RESPONDENT_COUNT);
  if (picked.length < SURVEY_RESPONDENT_COUNT) {
    throw new Error(`ptm: expected ${SURVEY_RESPONDENT_COUNT} eligible guardians, found ${picked.length}`);
  }

  const actors: string[] = [];
  for (const [i, guardian] of picked.entries()) {
    const email = `ptm.respondent.${i}@demo.coolskool.test`;
    const { data, error: createError } = await ctx.admin.auth.admin.createUser({
      email,
      password: SURVEY_ACTOR_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: guardian.full_name as string },
    });

    let userId: string;
    if (!createError && data.user) {
      userId = data.user.id;
    } else if (createError && /already.*registered|email_exists/i.test(createError.message)) {
      let found: string | undefined;
      for (let page = 1; !found; page++) {
        const { data: list, error: listError } = await ctx.admin.auth.admin.listUsers({ page, perPage: 200 });
        if (listError) throw listError;
        found = list.users.find((u) => u.email === email)?.id;
        if (list.users.length === 0) break;
      }
      if (!found) throw createError;
      userId = found;
    } else {
      throw createError ?? new Error(`createUser(${email}) returned no user and no error`);
    }

    await ctx.admin.from("guardians").update({ user_id: userId }).eq("id", guardian.id as string);
    await ctx.admin.from("memberships").upsert(
      {
        institution_id: ctx.institutionId,
        user_id: userId,
        role: "guardian",
        guardian_id: guardian.id as string,
        staff_id: null,
        student_id: null,
      },
      { onConflict: "institution_id,user_id,role" },
    );
    actors.push(userId);
  }
  return actors;
}

export async function run(ctx: SeedContext): Promise<void> {
  const principalUserId = ctx.userIdByLogin["principal"]!;

  // ---- sections in scope + their class teachers ----
  const sectionDefs = PTM_GRADE_CODES.flatMap((gradeCode) =>
    sectionNames(gradeCode).map((name) => {
      const key = sectionKey(gradeCode, name);
      return { key, id: uuidV5("academics", `section:${key}`) };
    }),
  );
  const { data: teacherRows, error: teacherError } = await ctx.admin
    .from("class_sections")
    .select("id, class_teacher_id")
    .in(
      "id",
      sectionDefs.map((s) => s.id),
    );
  if (teacherError) throw new Error(`ptm: class_sections query failed: ${teacherError.message}`);
  const classTeacherIdBySectionId = new Map((teacherRows ?? []).map((r) => [r.id as string, r.class_teacher_id as string]));
  const sections = sectionDefs.map((s) => ({ ...s, classTeacherId: classTeacherIdBySectionId.get(s.id)! }));

  // ---- event + sections ----
  const eventId = uuidV5("ptm", "event:term2-ptm");
  await ctx.admin.from("ptm_events").insert({
    id: eventId,
    institution_id: ctx.institutionId,
    title: EVENT_TITLE,
    event_date: EVENT_DATE,
    day_starts_at: DAY_STARTS_AT,
    day_ends_at: DAY_ENDS_AT,
    slot_minutes: SLOT_MINUTES,
    booking_closes_at: BOOKING_CLOSES_AT,
    status: "published",
    published_at: PUBLISHED_AT,
    published_by: principalUserId,
    created_by: principalUserId,
  });

  await insertBatch(
    ctx.admin,
    "ptm_event_sections",
    sections.map((s) => ({ event_id: eventId, institution_id: ctx.institutionId, class_section_id: s.id })),
  );

  // ---- slots: seq 0-23 for each section's (distinct) class teacher ----
  const slotIdBySectionSeq = new Map<string, string>();
  const seenTeacherIds = new Set<string>();
  const slotRows: Record<string, unknown>[] = [];
  for (const section of sections) {
    if (seenTeacherIds.has(section.classTeacherId)) continue; // defensive: cursor in academics.ts never repeats a teacher across sections.
    seenTeacherIds.add(section.classTeacherId);
    for (let seq = 0; seq < SLOT_COUNT; seq++) {
      const slotId = uuidV5("ptm", `slot:${section.key}:${seq}`);
      slotIdBySectionSeq.set(`${section.key}:${seq}`, slotId);
      slotRows.push({
        id: slotId,
        institution_id: ctx.institutionId,
        event_id: eventId,
        staff_id: section.classTeacherId,
        seq,
        created_by: principalUserId,
      });
    }
  }
  await insertBatch(ctx.admin, "ptm_slots", slotRows);

  // ---- survey response/booking actors (60 seeded guardians, logins granted) ----
  const actors = await ensureSurveyActors(ctx);

  // ---- bookings: ~40% of each section's slots, named exceptions per rulings ----
  const bookingRows: Record<string, unknown>[] = [];
  let actorCursor = 0;
  for (const section of sections) {
    const key = section.key;
    const studentsForSection = ctx.studentsBySection[key] ?? [];
    const bookedCount = Math.round(SLOT_COUNT * BOOKING_FRACTION);

    let reservedSeq: number | null = null;
    let reservedStudentId: string | null = null;
    let reservedBookedBy: string | null = null;
    let excludeFirstName: string | null = null;

    if (key === "VI-A") {
      reservedSeq = 6; // day_starts_at (09:00) + 6 * slot_minutes (10) = 10:00.
      reservedStudentId = studentsForSection.find((s) => s.firstName === "Aarav")!.id;
      reservedBookedBy = ctx.userIdByLogin["guardian.one"]!;
      excludeFirstName = "Aarav";
    } else if (key === "X-A") {
      excludeFirstName = "Ananya"; // left unbooked — the live demo books her.
    } else if (key === "VIII-B") {
      excludeFirstName = "Ishaan"; // left unbooked — the live demo books him.
    }

    const eligibleStudents = studentsForSection.filter((s) => s.firstName !== excludeFirstName);
    const neededRandom = bookedCount - (reservedSeq !== null ? 1 : 0);
    const seqPool = Array.from({ length: SLOT_COUNT }, (_, i) => i).filter((seq) => seq !== reservedSeq);

    const chosenSeqs = pickRandomDistinct(ctx.rng, seqPool, neededRandom);
    const chosenStudents = pickRandomDistinct(ctx.rng, eligibleStudents, neededRandom);

    const picks = chosenSeqs.map((seq, i) => ({
      seq,
      studentId: chosenStudents[i]!.id,
      bookedBy: actors[actorCursor++ % actors.length]!,
    }));
    if (reservedSeq !== null) {
      picks.push({ seq: reservedSeq, studentId: reservedStudentId!, bookedBy: reservedBookedBy! });
    }

    for (const pick of picks) {
      bookingRows.push({
        id: uuidV5("ptm", `booking:${key}:${pick.seq}`),
        institution_id: ctx.institutionId,
        event_id: eventId,
        staff_id: section.classTeacherId,
        slot_id: slotIdBySectionSeq.get(`${key}:${pick.seq}`)!,
        student_id: pick.studentId,
        booked_by: pick.bookedBy,
        status: "booked",
      });
    }
  }
  await insertBatch(ctx.admin, "ptm_bookings", bookingRows);

  // ---- survey: open, anonymous, school audience, 60 responses ----
  const surveyId = uuidV5("ptm", "survey:term1-feedback");
  await ctx.admin.from("surveys").insert({
    id: surveyId,
    institution_id: ctx.institutionId,
    title: SURVEY_TITLE,
    description: "Help us improve — four quick, anonymous questions about Term 1.",
    is_anonymous: true,
    questions: SURVEY_QUESTIONS as unknown as never,
    status: "open",
    closes_at: SURVEY_CLOSES_AT,
    opened_at: SURVEY_OPENED_AT,
    created_by: principalUserId,
  });

  await ctx.admin.from("survey_audiences").insert({
    id: uuidV5("ptm", "survey-audience:term1-feedback:school"),
    survey_id: surveyId,
    institution_id: ctx.institutionId,
    audience_type: "school",
  });

  const respondentRows = actors.map((userId) => ({
    survey_id: surveyId,
    institution_id: ctx.institutionId,
    user_id: userId,
    created_at: SURVEY_RESPONSE_STAMP,
    updated_at: SURVEY_RESPONSE_STAMP,
  }));
  await insertBatch(ctx.admin, "survey_respondents", respondentRows);

  const responseRows = actors.map((_userId, i) => ({
    id: uuidV5("ptm", `survey-response:term1-feedback:${i}`),
    institution_id: ctx.institutionId,
    survey_id: surveyId,
    respondent_user_id: null, // anonymous survey.
    answers: randomSurveyAnswers(ctx.rng),
    created_at: SURVEY_RESPONSE_STAMP,
    updated_at: SURVEY_RESPONSE_STAMP,
  }));
  await insertBatch(ctx.admin, "survey_responses", responseRows);
}
