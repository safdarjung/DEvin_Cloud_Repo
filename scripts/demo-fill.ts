import type { SupabaseClient } from "@supabase/supabase-js";
import { createScriptAdminClient } from "./lib/admin-client.ts";
import { uuidV5 } from "./seed/lib/ids.ts";

// Fills demo-school pages that would otherwise show an empty state (owner request, 2026-11-12).
// Run:  node --env-file-if-exists=.env.local scripts/demo-fill.ts [--apply]
// Default is a dry run. Refuses unless slug st-josephs-demo has is_demo = true. Idempotent: every
// row has a deterministic uuidV5 id and is inserted with ON CONFLICT DO NOTHING; nothing is ever
// updated or deleted (rule 5). Dates are relative to today in Asia/Kolkata. Service-role inserts
// bypass the definers/guards the same way the seed sections do (visitors, safety, canteen, ...).
// shortcut: demo-fill rows are not tracked by demo_reset; rerun this after `pnpm demo:reset`.

const SLUG = "st-josephs-demo";
const DAY_MS = 86_400_000;
const apply = process.argv.includes("--apply");
const id = (key: string) => uuidV5("demo-fill", key);

type Row = Record<string, unknown>;
interface Step { label: string; table: string; rows: Row[]; idCol: string; onConflict: string }
const steps: Step[] = [];
const put = (label: string, table: string, rows: Row[], idCol = "id", onConflict = "id") => {
  if (rows.length > 0) steps.push({ label, table, rows, idCol, onConflict });
};
const skipped: string[] = [];

// ---- dates (Asia/Kolkata) ----
const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const isSunday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;
const nextSchoolDay = (iso: string) => (isSunday(addDays(iso, 1)) ? addDays(iso, 2) : addDays(iso, 1));
const at = (iso: string, hhmm: string) => new Date(Date.parse(`${iso}T${hhmm}:00+05:30`)).toISOString();
const lastSchoolDays = (end: string, count: number) => {
  const days: string[] = [];
  for (let d = end; days.length < count; d = addDays(d, -1)) if (!isSunday(d)) days.unshift(d);
  return days;
};

async function must<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data ?? []) as T;
}

async function main() {
  process.env.SERVICE_ROLE_CALLER = "seed";
  const admin = createScriptAdminClient() as unknown as SupabaseClient;

  const [inst] = await must<{ id: string; is_demo: boolean }[]>(
    admin.from("institutions").select("id, is_demo").eq("slug", SLUG).limit(1),
    "institution lookup",
  );
  if (!inst) throw new Error(`Institution ${SLUG} not found.`);
  if (!inst.is_demo) throw new Error(`Refusing: ${SLUG} is not is_demo.`);
  const institution_id = inst.id;

  const today = todayIST();
  const now = Date.now();
  const startOfToday = Date.parse(`${today}T00:00:00+05:30`);

  // ---- demo logins -> user / staff / student ids ----
  const userByLogin: Record<string, string> = {};
  // Page through every auth user: test runs leave thousands, so demo logins can sit past page 1.
  for (let page = 1; ; page++) {
    const { data: userPage, error: userErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (userErr) throw new Error(`listUsers: ${userErr.message}`);
    for (const u of userPage.users) {
      if (u.email?.endsWith("@demo.coolskool.test")) userByLogin[u.email.split("@")[0]!] = u.id;
    }
    if (userPage.users.length < 1000) break;
  }
  const memberships = await must<{ user_id: string; staff_id: string | null; student_id: string | null }[]>(
    admin.from("memberships").select("user_id, staff_id, student_id").eq("institution_id", institution_id),
    "memberships",
  );
  const membershipOf = (login: string) => memberships.find((m) => m.user_id === userByLogin[login]);
  const user = (login: string) => {
    const v = userByLogin[login];
    if (!v) throw new Error(`demo login ${login} not found`);
    return v;
  };

  const [year] = await must<{ id: string }[]>(
    admin.from("academic_years").select("id").eq("institution_id", institution_id).eq("is_current", true).limit(1),
    "current year",
  );
  if (!year) throw new Error("no current academic year");

  const sectionsOf = async (login: string) => {
    const staffId = membershipOf(login)?.staff_id;
    if (!staffId) return [];
    return must<{ id: string; grade_id: string; name: string }[]>(
      admin.from("class_sections").select("id, grade_id, name").eq("institution_id", institution_id).eq("academic_year_id", year.id).eq("class_teacher_id", staffId).order("name"),
      `sections of ${login}`,
    );
  };
  const assignmentsOf = (sectionId: string) =>
    must<{ subject_id: string; teacher_id: string; subjects: { name: string; kind: string } | null }[]>(
      admin.from("subject_assignments").select("subject_id, teacher_id, subjects(name, kind)").eq("institution_id", institution_id).eq("class_section_id", sectionId).order("subject_id"),
      "subject assignments",
    );

  const teacherLogins = ["teacher.vi-a", "teacher.viii-b", "teacher.x-a"];

  // ===== diary: last 5 school days, one subject entry a day plus a general note, per demo section =====
  const diaryDays = lastSchoolDays(today, 5);
  const HW = [
    (s: string) => `${s}: finish the exercise discussed in class and revise today's notes.`,
    (s: string) => `${s}: read the next chapter and write down three questions to ask.`,
    (s: string) => `${s}: complete the worksheet given in class and bring it tomorrow.`,
  ];
  const diaryRows: Row[] = [];
  for (const login of teacherLogins) {
    const [section] = await sectionsOf(login);
    if (!section) { skipped.push(`diary: ${login} has no class section`); continue; }
    const subjects = (await assignmentsOf(section.id)).filter((a) => a.subjects?.kind !== "co_scholastic");
    if (subjects.length === 0) { skipped.push(`diary: ${section.name} has no subject assignments`); continue; }
    diaryDays.forEach((day, i) => {
      const a = subjects[i % subjects.length]!;
      diaryRows.push({
        id: id(`diary:${section.id}:${day}:hw`), institution_id, class_section_id: section.id, subject_id: a.subject_id, entry_date: day,
        body: HW[i % HW.length]!(a.subjects?.name ?? "Homework"), due_date: nextSchoolDay(day), requires_ack: false, created_by: user(login),
      });
    });
    diaryRows.push({
      id: id(`diary:${section.id}:${today}:note`), institution_id, class_section_id: section.id, subject_id: null, entry_date: today,
      body: "Reminder: bring the school diary and ID card every day. Sign the diary at home.", due_date: null, requires_ack: false, created_by: user(login),
    });
  }
  put("diary entries (last 5 school days)", "diary_entries", diaryRows);

  // ===== canteen: today's purchases for students already on the ledger =====
  const items = await must<{ id: string; name: string; price_paise: number }[]>(
    admin.from("canteen_items").select("id, name, price_paise").eq("institution_id", institution_id).eq("is_active", true).order("name"),
    "canteen items",
  );
  const ledger = await must<{ student_id: string; amount_paise: number }[]>(
    admin.from("canteen_transactions").select("student_id, amount_paise").eq("institution_id", institution_id).limit(5000),
    "canteen ledger",
  );
  const balances = new Map<string, number>();
  for (const t of ledger) balances.set(t.student_id, (balances.get(t.student_id) ?? 0) + t.amount_paise);
  const canteenStudents = [...balances.keys()].sort().slice(0, 8);
  if (items.length === 0 || canteenStudents.length === 0) {
    skipped.push("canteen: no menu items or no students on the ledger (run the seed first)");
  } else {
    const recordedBy = user("accountant");
    const canteenRows: Row[] = [];
    const existing = new Set(
      (await must<{ id: string }[]>(admin.from("canteen_transactions").select("id").in("id", canteenStudents.flatMap((s) => [id(`canteen:${today}:${s}:buy`), id(`canteen:${today}:${s}:topup`)])), "canteen existing")).map((r) => r.id),
    );
    canteenStudents.forEach((studentId, i) => {
      const buyId = id(`canteen:${today}:${studentId}:buy`);
      if (existing.has(buyId)) return;
      const item = items[(i * 3 + 1) % items.length]!;
      const quantity = i % 3 === 0 ? 2 : 1;
      const cost = quantity * item.price_paise;
      // clamp to today so a morning run never writes a future-dated sale
      const created = new Date(Math.max(startOfToday + 60_000, Math.min(now - (i + 1) * 60_000, startOfToday + (8 * 60 + 30 + i * 18) * 60_000))).toISOString();
      if ((balances.get(studentId) ?? 0) < cost) {
        canteenRows.push({ id: id(`canteen:${today}:${studentId}:topup`), institution_id, student_id: studentId, kind: "topup", amount_paise: 20_000, note: "Cash at office", recorded_by: recordedBy, created_at: created });
      }
      canteenRows.push({ id: buyId, institution_id, student_id: studentId, kind: "purchase", amount_paise: -cost, item_id: item.id, quantity, unit_price_paise: item.price_paise, recorded_by: recordedBy, created_at: created });
    });
    put("canteen sales today", "canteen_transactions", canteenRows);
  }

  // ===== visitors: five today, the last one still on campus =====
  const adminUser = user("admin");
  const hostStaff = (login: string) => membershipOf(login)?.staff_id ?? null;
  const VISITORS: { name: string; purpose: string; host: string | null; dept: string | null; offsetMin: number }[] = [
    { name: "Mahesh Kulkarni", purpose: "Fee enquiry", host: null, dept: "Accounts", offsetMin: 230 },
    { name: "Anjali Deshpande", purpose: "Admission enquiry", host: null, dept: "Office", offsetMin: 170 },
    { name: "Rohit Banerjee", purpose: "Vendor delivery", host: "admin", dept: null, offsetMin: 110 },
    { name: "Sheela Naidu", purpose: "Meeting principal", host: "principal", dept: null, offsetMin: 60 },
    { name: "Imran Qureshi", purpose: "PTM follow-up", host: null, dept: "Office", offsetMin: 20 },
  ];
  const visitorRows = VISITORS.map((v, i) => {
    const inAt = Math.max(startOfToday + 5 * 60_000, now - v.offsetMin * 60_000);
    const outAt = i < VISITORS.length - 1 ? inAt + 30 * 60_000 : null;
    const staffId = v.host ? hostStaff(v.host) : null;
    return {
      id: id(`visitor:${today}:${i}`), institution_id, full_name: v.name, phone: `9700002${String(i + 10).padStart(3, "0")}`, purpose: v.purpose,
      host_staff_id: staffId, meeting_with: staffId ? null : (v.dept ?? "Office"),
      id_type: i % 2 === 0 ? "aadhaar" : null, id_last4: i % 2 === 0 ? String(4100 + i) : null,
      checked_in_at: new Date(inAt).toISOString(), checked_in_by: adminUser,
      checked_out_at: outAt && outAt <= now ? new Date(outAt).toISOString() : null, checked_out_by: outAt && outAt <= now ? adminUser : null,
    };
  });
  put("visitors today", "visitor_entries", visitorRows);

  // ===== safety: one active, benign drill notice (fixed id, so it is added once) =====
  const drillId = id("safety:active-drill");
  put("safety active alert", "safety_alerts", [{
    id: drillId, institution_id, kind: "drill", title: "Evacuation drill this week",
    message: "A practice evacuation drill will be held this week without prior notice. When the long bell rings, leave by your class's marked route and assemble on the main ground. Class teachers take the roll and report the headcount.",
    audience: "all", status: "active", created_by: user("principal"), created_at: new Date(now - 90 * 60_000).toISOString(),
  }]);
  put("safety acknowledgements", "safety_acknowledgements",
    ["principal", "admin", "teacher.x-a"].map((l, i) => ({ id: id(`safety:ack:${l}`), institution_id, alert_id: drillId, user_id: user(l), created_at: new Date(now - (60 - i * 10) * 60_000).toISOString() })));

  // ===== alumni: six graduates (no lifecycle events or enrolments, so they never touch /students/lifecycle) =====
  const ALUMNI = [
    { first: "Rahul", last: "Verma", gender: "male", batch: 2023, city: "Pune", job: "Software engineer", dob: "2005-03-14" },
    { first: "Sneha", last: "Kulkarni", gender: "female", batch: 2023, city: "Mumbai", job: "Medical student", dob: "2005-07-22" },
    { first: "Aditya", last: "Joshi", gender: "male", batch: 2024, city: "Bengaluru", job: "B.Tech student", dob: "2006-01-09" },
    { first: "Pooja", last: "Nair", gender: "female", batch: 2024, city: "Hyderabad", job: "Chartered accountancy trainee", dob: "2006-05-30" },
    { first: "Karthik", last: "Iyer", gender: "male", batch: 2025, city: "Delhi", job: "Law student", dob: "2007-02-18" },
    { first: "Meera", last: "Patil", gender: "female", batch: 2025, city: "Pune", job: "Design student", dob: "2007-09-03" },
  ];
  put("alumni students", "students", ALUMNI.map((a, i) => ({
    id: id(`alumni:student:${i}`), institution_id, admission_no: `ADM/${a.batch - 12}/009${String(i + 1).padStart(2, "0")}`,
    first_name: a.first, last_name: a.last, dob: a.dob, gender: a.gender, status: "alumni",
  })));
  put("alumni profiles", "alumni_profiles", ALUMNI.map((a, i) => ({
    id: id(`alumni:profile:${i}`), institution_id, student_id: id(`alumni:student:${i}`), batch_year: a.batch,
    contact_email: `${a.first.toLowerCase()}.${a.last.toLowerCase()}@example.com`, contact_phone: `9811100${String(i + 1).padStart(3, "0")}`, occupation: a.job, city: a.city,
  })));

  // ===== student.one (Ananya, X-A) =====
  const ananyaId = membershipOf("student.one")?.student_id;
  const [enrol] = ananyaId
    ? await must<{ class_section_id: string }[]>(
        admin.from("enrolments").select("class_section_id").eq("institution_id", institution_id).eq("student_id", ananyaId).eq("status", "active").limit(1),
        "ananya enrolment",
      )
    : [];
  if (!ananyaId || !enrol) {
    skipped.push("student.one areas: demo student or active enrolment not found");
  } else {
    const teacher = user("teacher.x-a");
    const principal = user("principal");

    put("portal achievements", "achievements", [
      { t: "Inter-school quiz competition", c: "academic", l: "district", p: "Runner-up", d: -26, desc: "Represented the school in the science and maths round." },
      { t: "Annual sports day 200m race", c: "sports", l: "school", p: "2nd", d: -19, desc: null },
      { t: "Student council: class representative", c: "leadership", l: "school", p: null, d: -12, desc: "Elected by the class for this term." },
    ].map((a, i) => ({
      id: id(`achievement:${i}`), institution_id, student_id: ananyaId, title: a.t, category: a.c, level: a.l, position: a.p,
      event_date: addDays(today, a.d), description: a.desc, recorded_by: teacher, verified_at: at(addDays(today, a.d + 2), "10:00"), verified_by: principal,
    })));

    put("portal behaviour", "behaviour_incidents", [
      { c: "Helpfulness", s: "low", pts: 5, n: "Helped a classmate catch up on missed work.", d: -3 },
      { c: "Academic effort", s: "low", pts: 10, n: "Strong improvement in the periodic test.", d: -8 },
      { c: "Leadership", s: "medium", pts: 15, n: "Led the class cleanliness drive.", d: -15 },
      { c: "Punctuality", s: "low", pts: -2, n: "Late to first period once; spoke to the class teacher.", d: -21 },
      { c: "Helpfulness", s: "low", pts: 5, n: "Guided the new student around the school.", d: -28 },
    ].map((b, i) => ({
      id: id(`behaviour:${i}`), institution_id, student_id: ananyaId, category: b.c, severity: b.s, points: b.pts, note: b.n,
      occurred_on: addDays(today, b.d), reported_by: i % 2 === 0 ? teacher : principal,
    })));

    // upcoming exam: 4 papers 3-14 days out for X-A (a new exam; existing exams are untouched)
    const subjects = (await assignmentsOf(enrol.class_section_id)).filter((a) => a.subjects?.kind === "scholastic").slice(0, 4);
    const [section] = await must<{ academic_year_id: string }[]>(
      admin.from("class_sections").select("academic_year_id").eq("id", enrol.class_section_id).limit(1), "x-a section");
    const offsets = [3, 5, 8, 11];
    const paperDays = offsets.map((o) => (isSunday(addDays(today, o)) ? addDays(today, o + 1) : addDays(today, o)));
    const terms = await must<{ id: string; starts_on: string; ends_on: string }[]>(
      admin.from("terms").select("id, starts_on, ends_on").eq("institution_id", institution_id).eq("academic_year_id", section?.academic_year_id ?? year.id).order("sequence"),
      "terms",
    );
    const term = terms.find((t) => t.starts_on <= paperDays[0]! && paperDays[0]! <= t.ends_on) ?? terms[terms.length - 1];
    if (subjects.length === 0 || !term) {
      skipped.push("portal exams: X-A has no scholastic subject assignments or the year has no terms");
    } else {
      const examId = id("exam:pt3-x");
      put("upcoming exam (X-A)", "exams", [{
        id: examId, institution_id, academic_year_id: section?.academic_year_id ?? year.id, term_id: term.id,
        name: "Periodic Test 3 (Grade X)", type: "unit_test", status: "marks_entry", grading_scale_key: "default",
      }]);
      put("upcoming exam papers (X-A)", "exam_papers", subjects.map((a, i) => ({
        id: id(`exam:pt3-x:paper:${a.subject_id}`), institution_id, exam_id: examId, class_section_id: enrol.class_section_id, subject_id: a.subject_id,
        max_marks: 40, pass_marks: 13, scheduled_at: at(paperDays[i]!, "09:30"), duration_minutes: 90, room_id: null,
      })));
    }

    // library: three books returned on time in the past month (copies not currently on loan)
    const open = await must<{ copy_id: string }[]>(
      admin.from("library_loans").select("copy_id").eq("institution_id", institution_id).is("returned_on", null).limit(2000), "open loans");
    const openIds = new Set(open.map((l) => l.copy_id));
    const copies = (await must<{ id: string }[]>(
      admin.from("library_copies").select("id").eq("institution_id", institution_id).eq("status", "active").order("accession_no").limit(1000), "copies",
    )).filter((c) => !openIds.has(c.id));
    if (copies.length < 3) {
      skipped.push("portal library: fewer than 3 free library copies");
    } else {
      const librarian = user("principal");
      put("portal library returns", "library_loans", [28, 20, 12].map((daysAgo, i) => {
        const issued = addDays(today, -daysAgo);
        const due = addDays(issued, 14);
        return {
          id: id(`loan:ananya:${i}`), institution_id, copy_id: copies[Math.floor(((i * 2 + 1) * copies.length) / 7)]!.id, student_id: ananyaId,
          issued_on: issued, due_on: due, returned_on: addDays(due, -(2 + i)), issued_by: librarian, returned_by: librarian,
        };
      }));
    }
  }

  // ===== study studio: one teacher-shared item per teacher that has none (teacher.x-a is seeded) =====
  for (const login of ["teacher.vi-a", "teacher.viii-b"]) {
    const staffId = membershipOf(login)?.staff_id;
    const [section] = await sectionsOf(login);
    if (!staffId || !section) { skipped.push(`study studio: ${login} has no class section`); continue; }
    const taught = (await assignmentsOf(section.id)).find((a) => a.subjects?.kind === "scholastic");
    const [unit] = taught
      ? await must<{ id: string; title: string }[]>(
          admin.from("curriculum_units").select("id, title").eq("institution_id", institution_id).eq("subject_id", taught.subject_id).eq("grade_id", section.grade_id).order("sequence").limit(1),
          "curriculum unit",
        )
      : [];
    if (!taught || !unit) { skipped.push(`study studio: no curriculum unit for ${login}`); continue; }
    const materialId = id(`study:${login}:concepts`);
    put(`study studio shared item (${login})`, "study_materials", [{
      id: materialId, institution_id, user_id: user(login), owner_role: "teacher", format: "key_concepts", title: `Key concepts: ${unit.title}`,
      subject_id: taught.subject_id, curriculum_unit_id: unit.id, source_kind: "unit", ai_generated: true, created_at: new Date(now - 2 * DAY_MS).toISOString(),
      content: { concepts: [
        { name: "Main idea", explanation: `A short overview of ${unit.title} as covered in class this term.`, example: "Revisit the worked example from your notebook." },
        { name: "Key terms", explanation: `List the new words from ${unit.title} and write one line on each.`, example: "Use each term in a sentence of your own." },
        { name: "Common mistake", explanation: "Read the question twice before answering and check units and spelling.", example: "Underline what the question asks for." },
      ] },
    }]);
    put(`study studio audience (${login})`, "study_material_sections", [{ material_id: materialId, institution_id, class_section_id: section.id }], "material_id", "material_id,class_section_id");
  }

  // ===== run =====
  console.log(`${apply ? "APPLY" : "DRY RUN"} - ${SLUG} (is_demo), today ${today} IST`);
  for (const step of steps) {
    const ids = step.rows.map((r) => r[step.idCol] as string);
    const present = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const found = await must<Record<string, string>[]>(admin.from(step.table).select(step.idCol).in(step.idCol, ids.slice(i, i + 100)), `${step.table} existing`);
      for (const r of found) present.add(r[step.idCol]!);
    }
    const fresh = step.rows.filter((r) => !present.has(r[step.idCol] as string));
    console.log(`  ${step.label}: ${fresh.length} new, ${step.rows.length - fresh.length} already present (${step.table})`);
    if (apply && fresh.length > 0) {
      const { error } = await admin.from(step.table).upsert(fresh, { onConflict: step.onConflict, ignoreDuplicates: true });
      if (error) throw new Error(`insert into ${step.table} failed: ${error.message}`);
    }
  }
  for (const s of skipped) console.log(`  SKIPPED ${s}`);
  console.log("  NOT FILLED: students/lifecycle (needs a second academic year with sections and enrolments; no migrations or whole-year data here).");
  if (!apply) console.log("Dry run only. Re-run with --apply to insert.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
