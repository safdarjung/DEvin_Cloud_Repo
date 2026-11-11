import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { mulberry32 } from "../lib/prng.ts";

// Features-18 #6 — demo clubs, houses, house points and club events.
// Own mulberry32 stream (fixed seed), so this section never shifts ctx.rng.
// Inserted with the service role: membership/sign-up/points tables have no
// client write grant (definers only), the service-role bypass is the seed path.
const CLUBS = [
  ["Robotics Club", "Build and program small robots; monthly challenge nights.", "teacher.x-a", 25],
  ["Debate Society", "Parliamentary debate practice and inter-school rounds.", "teacher.viii-b", 20],
  ["Art & Craft Club", "Painting, clay and paper craft after school.", "teacher.vi-a", 30],
  ["Eco Club", "Recycling drives, school garden and awareness days.", "teacher.vi-a", null],
  ["Football Club", "Coached practice twice a week.", "teacher.x-a", 30],
  ["Quiz Club", "Weekly quizzes and the annual inter-house quiz.", "teacher.viii-b", 20],
] as const;
const HOUSES = [
  ["Red House", "#DC2626"],
  ["Blue House", "#2563EB"],
  ["Green House", "#16A34A"],
  ["Yellow House", "#CA8A04"],
] as const;
const EVENT_DATES = ["2026-10-20", "2026-10-22", "2026-10-24", "2026-11-12", "2026-11-15", "2026-11-18", "2026-11-21", "2026-11-25", "2026-11-28", "2026-12-02", "2026-12-05", "2026-12-09"];
const EVENT_TITLES = ["Open day demo", "Inter-house challenge", "Workshop", "Practice match", "Showcase", "Guest talk"];
const POINT_REASONS = ["Sports day winner", "Helped organise assembly", "Quiz champion", "Clean classroom week", "Debate finalist", "Late to assembly", "Team spirit"];

export async function run(ctx: SeedContext): Promise<void> {
  const rng = mulberry32(115);
  const adminUser = ctx.userIdByLogin["admin"]!;
  const principalUser = ctx.userIdByLogin["principal"]!;

  const clubRows = CLUBS.map(([name, description, patron, capacity], i) => ({
    id: uuidV5("clubs", `club:${i}`),
    institution_id: ctx.institutionId,
    name,
    description,
    patron_staff_id: ctx.linkIdByLogin[patron] ?? null,
    capacity,
  }));
  await insertBatch(ctx.admin, "clubs", clubRows);

  const houseRows = HOUSES.map(([name, colour], i) => ({ id: uuidV5("clubs", `house:${i}`), institution_id: ctx.institutionId, name, colour }));
  await insertBatch(ctx.admin, "houses", houseRows);

  // 40 students: first 10 of the first four sections (sorted), plus Aarav (demo guardian's child).
  const sectionKeys = Object.keys(ctx.studentsBySection).sort();
  const pool = new Map<string, string>();
  for (const key of sectionKeys.slice(0, 4)) {
    for (const s of [...ctx.studentsBySection[key]!].sort((a, b) => a.firstName.localeCompare(b.firstName)).slice(0, 10)) pool.set(s.id, s.firstName);
  }
  const aarav = ctx.studentsBySection["VI-A"]?.find((s) => s.firstName === "Aarav");
  if (aarav) pool.set(aarav.id, aarav.firstName);
  const students = [...pool.keys()];

  const houseOf = new Map<string, string>();
  await insertBatch(
    ctx.admin,
    "house_members",
    students.map((studentId, i) => {
      houseOf.set(studentId, houseRows[i % houseRows.length]!.id);
      return { id: uuidV5("clubs", `hm:${studentId}`), institution_id: ctx.institutionId, house_id: houseRows[i % houseRows.length]!.id, student_id: studentId };
    }),
  );

  // Each student joins 0-2 clubs, capped by club capacity.
  const memberCount = new Map<string, number>();
  const memberRows: Record<string, unknown>[] = [];
  students.forEach((studentId, i) => {
    const picks = new Set<number>([i % CLUBS.length]);
    if (rng() < 0.4) picks.add(Math.floor(rng() * CLUBS.length));
    if (i % 5 === 4) picks.clear();
    for (const c of picks) {
      const cap = CLUBS[c]![3];
      if (cap !== null && (memberCount.get(clubRows[c]!.id) ?? 0) >= cap) continue;
      memberCount.set(clubRows[c]!.id, (memberCount.get(clubRows[c]!.id) ?? 0) + 1);
      memberRows.push({ id: uuidV5("clubs", `cm:${clubRows[c]!.id}:${studentId}`), institution_id: ctx.institutionId, club_id: clubRows[c]!.id, student_id: studentId, joined_by: adminUser });
    }
  });
  await insertBatch(ctx.admin, "club_members", memberRows);

  // 12 events: 3 already past, 9 upcoming. Fixed dates, IST.
  const eventRows = EVENT_DATES.map((date, i) => {
    const hour = String(10 + (i % 5));
    return {
      id: uuidV5("clubs", `event:${i}`),
      institution_id: ctx.institutionId,
      club_id: clubRows[i % clubRows.length]!.id,
      title: `${CLUBS[i % CLUBS.length]![0].split(" ")[0]} ${EVENT_TITLES[i % EVENT_TITLES.length]}`,
      description: "Open to all club members and interested students.",
      venue: i % 2 === 0 ? "School hall" : "Playground",
      starts_at: `${date}T${hour}:00:00+05:30`,
      ends_at: `${date}T${hour}:45:00+05:30`,
      signup_closes_at: i < 3 ? null : `${date}T08:00:00+05:30`,
      capacity: i % 3 === 0 ? 20 : null,
      status: i === 11 ? "cancelled" : "scheduled",
    };
  });
  await insertBatch(ctx.admin, "club_events", eventRows);

  // Sign-ups: club members sign up for their own club's events (not the cancelled one).
  const signupRows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const m of memberRows) {
    for (const e of eventRows) {
      if (e.club_id !== m.club_id || e.status === "cancelled" || rng() > 0.7) continue;
      const key = `${e.id}:${m.student_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      signupRows.push({ id: uuidV5("clubs", `su:${key}`), institution_id: ctx.institutionId, event_id: e.id, student_id: m.student_id, signed_up_by: adminUser });
    }
  }
  await insertBatch(ctx.admin, "club_event_signups", signupRows);

  // 32 house-point awards (append-only table): mostly positive, some whole-house.
  const pointRows = Array.from({ length: 32 }, (_, i) => {
    const studentId = i % 4 === 0 ? null : students[Math.floor(rng() * students.length)]!;
    const houseId = studentId ? houseOf.get(studentId)! : houseRows[i % houseRows.length]!.id;
    const reason = POINT_REASONS[i % POINT_REASONS.length]!;
    const points = reason === "Late to assembly" ? -2 : 3 + Math.floor(rng() * 8);
    return {
      id: uuidV5("clubs", `pt:${i}`),
      institution_id: ctx.institutionId,
      house_id: houseId,
      student_id: studentId,
      points,
      reason,
      awarded_by: i % 2 === 0 ? adminUser : principalUser,
    };
  });
  await insertBatch(ctx.admin, "house_points", pointRows);
}
