#!/usr/bin/env node
// AI smoke harness: signs in as the right demo role for each AI feature, POSTs a
// realistic input built from real ids in the seeded demo tenant, and prints one
// line per feature (role, HTTP status, provider/model, output-shape check,
// latency, error category). Read-only: every AI route is draft-only, and the
// id lookups are plain SELECTs.
//
//   node --env-file-if-exists=.env.local scripts/ai-smoke.ts [--base http://localhost:3230]
//        [--only translate,quiz] [--allow-remote] [--gap 3000] [--slug st-josephs-demo]
//
// Never prints keys, tokens or cookies. Refuses a non-loopback app or database
// URL unless --allow-remote is passed. Paces calls on the token counts the
// usage log records, so the run itself stays under a free-tier per-minute limit.
import { parseArgs } from "node:util";
import postgres from "postgres";
import { z } from "zod";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3230" },
    only: { type: "string" },
    slug: { type: "string", default: "st-josephs-demo" },
    gap: { type: "string", default: "3000" },
    "allow-remote": { type: "boolean", default: false },
  },
});

const BASE = new URL(args.base as string).origin;
const SLUG = args.slug as string;
const GAP_MS = Number(args.gap);
// Groq free tier is ~8k tokens/min per model; keep headroom for the next call.
const TOKENS_PER_MINUTE_BUDGET = 6000;
const NEXT_CALL_ESTIMATE = 2500;

const isLoopback = (url: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set (run with --env-file-if-exists=.env.local).");
if (!args["allow-remote"] && (!isLoopback(BASE) || !isLoopback(dbUrl))) {
  console.error("Refusing a non-local app or database URL. Pass --allow-remote to override.");
  process.exit(2);
}

const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });

// ---- demo tenant lookups ----------------------------------------------------
type Row = Record<string, string>;
const one = async (query: Promise<Row[]>, what: string): Promise<Row> => {
  const [row] = await query;
  if (!row) throw new Error(`Seed lookup found no ${what}.`);
  return row;
};

const EMAIL = {
  principal: "principal@demo.coolskool.test",
  admin: "admin@demo.coolskool.test",
  admissions: "admissions@demo.coolskool.test",
  examController: "examcontroller@demo.coolskool.test",
  teacherVIA: "teacher.vi-a@demo.coolskool.test",
  teacherXA: "teacher.x-a@demo.coolskool.test",
  student: "student.one@demo.coolskool.test",
} as const;

async function lookups() {
  const inst = await one(sql`select id from institutions where slug = ${SLUG}`, "institution");
  const staffOf = (email: string) =>
    one(sql`select m.staff_id, m.user_id from memberships m join auth.users u on u.id = m.user_id
            where m.institution_id = ${inst.id} and u.email = ${email}`, `membership for ${email}`);
  const xa = await staffOf(EMAIL.teacherXA);
  const via = await staffOf(EMAIL.teacherVIA);
  const maths = await one(
    sql`select sa.class_section_id, sa.subject_id, cs.grade_id from subject_assignments sa
        join class_sections cs on cs.id = sa.class_section_id join grades g on g.id = cs.grade_id
        join subjects s on s.id = sa.subject_id
        where sa.institution_id = ${inst.id} and sa.teacher_id = ${xa.staff_id} and g.code = 'X' and cs.name = 'A' and s.name = 'Mathematics'`,
    "X-A Mathematics assignment",
  );
  const unit = await one(
    sql`select id from curriculum_units where grade_id = ${maths.grade_id} and subject_id = ${maths.subject_id} order by sequence limit 1`,
    "X Mathematics unit",
  );
  const xaStudent = await one(
    sql`select student_id from enrolments where class_section_id = ${maths.class_section_id} and status = 'active' order by roll_no limit 1`,
    "X-A student",
  );
  const result = await one(
    sql`select r.id from results r join enrolments e on e.student_id = r.student_id
        where e.class_section_id = ${maths.class_section_id} and e.status = 'active' and r.superseded_by is null
        order by r.created_at desc limit 1`,
    "X-A result",
  );
  const viaSection = await one(
    sql`select id from class_sections where institution_id = ${inst.id} and class_teacher_id = ${via.staff_id} limit 1`,
    "VI-A section",
  );
  const enquiry = await one(sql`select id from enquiries where institution_id = ${inst.id} order by created_at desc limit 1`, "enquiry");
  const ticket = await one(
    sql`select id from helpdesk_tickets where institution_id = ${inst.id} and status in ('open', 'in_progress') order by created_at desc limit 1`,
    "open helpdesk ticket",
  );
  const sub = await one(
    sql`select id from substitutions where institution_id = ${inst.id} and date = (now() at time zone 'Asia/Kolkata')::date and status <> 'cancelled' limit 1`,
    "today's substitution",
  );
  const lab = await one(
    sql`select lab_id from school_lab_equipment where institution_id = ${inst.id} and (hazard_class is not null or expiry_on < current_date) limit 1`,
    "lab with a safety warning",
  );
  const invoice = await one(
    sql`select id, term_id from invoices where institution_id = ${inst.id} and status in ('issued', 'part_paid')
        and term_id is not null and due_on < current_date order by due_on limit 1`,
    "overdue invoice",
  );
  // 0140 study help: student.one's own summary and a Science unit of their section; teacher.x-a's shared deck.
  const studentUser = await one(sql`select u.id from auth.users u where u.email = ${EMAIL.student}`, "student.one login");
  const studentMaterial = await one(
    sql`select id from study_materials where institution_id = ${inst.id} and user_id = ${studentUser.id} and format = 'quick_summary' and language = 'en' and variant_of is null order by created_at limit 1`,
    "student.one summary",
  );
  const teacherMaterial = await one(
    sql`select id from study_materials where institution_id = ${inst.id} and user_id = ${xa.user_id} and owner_role = 'teacher' and format = 'flashcards' order by created_at limit 1`,
    "teacher.x-a deck",
  );
  const studentUnit = await one(
    sql`select cu.id, cu.subject_id from memberships m join enrolments e on e.student_id = m.student_id and e.status = 'active'
        join subject_assignments sa on sa.class_section_id = e.class_section_id join subjects s on s.id = sa.subject_id and s.code = 'SCI'
        join class_sections cs on cs.id = e.class_section_id
        join curriculum_units cu on cu.subject_id = s.id and cu.grade_id = cs.grade_id
        where m.institution_id = ${inst.id} and m.user_id = ${studentUser.id} order by cu.sequence limit 1`,
    "student.one Science unit",
  );
  return { maths, unit, xaStudent, result, viaSection, enquiry, ticket, sub, lab, invoice, studentMaterial, teacherMaterial, studentUnit };
}

// ---- features -----------------------------------------------------------------
type Ids = Awaited<ReturnType<typeof lookups>>;
interface Feature {
  name: string;
  email: string;
  path: string;
  body: (ids: Ids) => Record<string, unknown>;
  /** The route's own success payload shape (data of the ActionResult envelope). */
  output?: z.ZodType;
  /** A UI message stream instead of a JSON envelope. */
  chat?: boolean;
  /** Error category this role must get (a gate that has to hold). */
  expectError?: string;
}

const provider = { provider: z.enum(["local", "cloud"]), model: z.string().min(1) };
const text = z.string().min(1);
const user = (t: string) => ({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: t }] }] });

const FEATURES: Feature[] = [
  { name: "translate", email: EMAIL.teacherXA, path: "translate",
    body: () => ({ text: "The school will remain closed on Friday for the annual sports day. Please collect your child by 1 pm on Thursday.", language: "hi" }),
    output: z.object({ translation: text, ...provider }) },
  { name: "quiz", email: EMAIL.teacherXA, path: "quiz",
    body: (i) => ({ curriculumUnitId: i.unit.id, questionCount: 10, difficulty: "medium" }),
    output: z.object({ content: z.object({ questions: z.array(z.unknown()).min(5) }).passthrough(), ...provider }).passthrough() },
  { name: "report-remark", email: EMAIL.teacherXA, path: "report-remark",
    body: (i) => ({ resultId: i.result.id }), output: z.object({ remark: text, ...provider }) },
  { name: "report-remark(exam_controller)", email: EMAIL.examController, path: "report-remark",
    body: (i) => ({ resultId: i.result.id }), expectError: "gated" },
  { name: "enquiry-reply", email: EMAIL.admissions, path: "enquiry-reply",
    body: (i) => ({ enquiryId: i.enquiry.id }), output: z.object({ reply: text, ...provider }).passthrough() },
  { name: "attendance-insight", email: EMAIL.teacherVIA, path: "attendance-insight",
    body: (i) => ({
      classSectionId: i.viaSection.id,
      students: Array.from({ length: 12 }, (_, index) => ({
        index, presentCount: 18 - (index % 5), absentCount: index % 5, lateCount: index % 3,
        recentAbsentDayOffsets: index % 4 === 0 ? [0, 1, 2] : [],
      })),
    }),
    output: z.object({ items: z.array(z.unknown()), ...provider }).passthrough() },
  { name: "dashboard-briefing", email: EMAIL.principal, path: "dashboard-briefing",
    body: () => ({ attendancePercent: 91.5, sectionsAtRiskCount: 2, openEnquiries: 7, enrolledCount: 1180, collections: null }),
    output: z.object({ summary: text }).passthrough() },
  { name: "practice-quiz", email: EMAIL.student, path: "practice-quiz",
    body: (i) => ({ unitId: i.unit.id, difficulty: "easy", count: 3 }), output: z.object({ questions: z.array(z.unknown()).min(1) }).passthrough() },
  { name: "lab-scenario", email: EMAIL.principal, path: "lab-scenario",
    body: () => ({ text: "What if attendance drops 5 points and fees go up by 8 percent next year?" }),
    output: z.object({ assumptions: z.record(z.string(), z.unknown()), ...provider }) },
  { name: "lab-explain", email: EMAIL.principal, path: "lab-explain",
    body: () => ({ kind: "correlation" }), output: z.object({ bullets: z.array(text).min(1), source: z.literal("ai") }).passthrough() },
  { name: "lesson-plan", email: EMAIL.teacherXA, path: "lesson-plan",
    body: (i) => ({ classSectionId: i.maths.class_section_id, subjectId: i.maths.subject_id, curriculumUnitId: i.unit.id, periods: 3 }),
    output: z.object({ draft: z.object({ periods: z.array(z.unknown()).min(1) }).passthrough(), ...provider }).passthrough() },
  { name: "question-paper", email: EMAIL.teacherXA, path: "question-paper",
    body: (i) => ({ gradeId: i.maths.grade_id, subjectId: i.maths.subject_id, totalMarks: 14,
      rows: [{ curriculumUnitId: i.unit.id, difficulty: "hard", marks: 7, count: 2 }] }),
    output: z.object({ drafts: z.array(z.unknown()).min(1), aiNote: z.null() }).passthrough() },
  { name: "fee-reminder-draft", email: EMAIL.admin, path: "fee-reminder-draft",
    body: (i) => ({ invoiceId: i.invoice.id, termId: i.invoice.term_id }), output: z.object({ sms: text, whatsapp: text, callScript: text }).passthrough() },
  { name: "ptm-brief", email: EMAIL.teacherXA, path: "ptm-brief",
    body: (i) => ({ studentId: i.xaStudent.student_id }), output: z.object({ brief: z.unknown(), ...provider }).passthrough() },
  { name: "helpdesk-triage", email: EMAIL.admin, path: "helpdesk-triage",
    body: (i) => ({ ticketId: i.ticket.id }), output: z.object({ ...provider }).passthrough() },
  { name: "form-draft", email: EMAIL.admin, path: "form-draft",
    body: () => ({ description: "Permission slip for the class VIII science museum trip: parent name, phone, consent yes/no, any allergies, pickup point." }),
    output: z.object({ title: text, fields: z.array(z.unknown()).min(1) }).passthrough() },
  { name: "substitution-note", email: EMAIL.admin, path: "substitution-note",
    body: (i) => ({ substitutionId: i.sub.id }), output: z.object({ note: text }).passthrough() },
  { name: "lab-safety-note", email: EMAIL.principal, path: "lab-safety-note",
    body: (i) => ({ labId: i.lab.lab_id }), output: z.object({ note: text, source: z.literal("ai") }).passthrough() },
  { name: "import-mapping", email: EMAIL.admin, path: "import-mapping",
    body: () => ({ entityType: "students", headers: ["Student Name", "Adm Number", "D.O.B", "Father's Mobile No.", "Class-Sec", "Blood grp", "Residential Addr"] }),
    output: z.object({ suggestions: z.array(z.unknown()).min(1), ...provider }) },
  { name: "website-draft", email: EMAIL.admin, path: "website-draft",
    body: () => ({ kind: "about", tone: "warm", brief: "A CBSE school founded in 1962, known for science labs, a strong football team and a free evening library for the neighbourhood." }),
    output: z.object({ blocks: z.array(z.unknown()).min(1) }).passthrough() },
  { name: "website-theme", email: EMAIL.admin, path: "website-theme",
    body: () => ({ brief: "Warm and traditional, navy and gold, easy to read for grandparents." }), output: z.object({ theme: z.unknown() }).passthrough() },
  { name: "workflow-draft", email: EMAIL.principal, path: "workflow-draft",
    body: () => ({ description: "Every Monday at 9 am, if any fee invoice is overdue, send the parents a reminder and tell the accountant." }),
    output: z.object({ name: text, form: z.unknown() }).passthrough() },
  // 0140 study help
  { name: "study-teacher-generate(worksheet)", email: EMAIL.teacherXA, path: "study-teacher-generate",
    body: (i) => ({ format: "worksheet", source: { kind: "unit", unitId: i.unit.id } }),
    output: z.object({ format: z.literal("worksheet"), content: z.object({ levels: z.array(z.unknown()).length(3) }), ...provider }).passthrough() },
  { name: "study-generate(revision pack)", email: EMAIL.student, path: "study-generate",
    body: () => ({ format: "revision_notes", source: { kind: "weak_units" } }),
    output: z.object({ sourceKind: z.literal("revision_pack"), focusUnitIds: z.array(z.string()).min(1), ...provider }).passthrough() },
  { name: "study-mock", email: EMAIL.student, path: "study-mock",
    body: (i) => ({ scope: { kind: "units", subjectId: i.studentUnit.subject_id, unitIds: [i.studentUnit.id], durationMinutes: 15 }, count: 10, difficulty: "easy" }),
    output: z.object({ content: z.object({ questions: z.array(z.unknown()).min(1) }).passthrough(), ...provider }).passthrough() },
  { name: "study-translate", email: EMAIL.student, path: "study-translate",
    body: (i) => ({ materialId: i.studentMaterial.id, language: "hi" }), output: z.object({ language: z.literal("hi"), content: z.unknown(), ...provider }).passthrough() },
  { name: "study-teacher-translate", email: EMAIL.teacherXA, path: "study-teacher-translate",
    body: (i) => ({ materialId: i.teacherMaterial.id, language: "hi" }), output: z.object({ language: z.literal("hi"), content: z.unknown(), ...provider }).passthrough() },
  { name: "chat:assistant", email: EMAIL.admin, path: "agent/assistant", chat: true, body: () => user("How many enquiries are open right now?") },
  { name: "chat:teacher", email: EMAIL.teacherXA, path: "agent/teacher", chat: true, body: () => user("Which of my classes has the lowest attendance this week?") },
  { name: "chat:student", email: EMAIL.student, path: "agent/student", chat: true, body: () => user("Explain what a quadratic equation is in two lines.") },
];

// ---- HTTP -----------------------------------------------------------------------
const jars = new Map<string, string>();
async function cookieFor(email: string): Promise<string> {
  const cached = jars.get(email);
  if (cached) return cached;
  const res = await fetch(`${BASE}/api/public/demo-login`, {
    method: "POST",
    headers: { origin: BASE },
    body: new URLSearchParams({ email, next: `/${SLUG}` }),
    redirect: "manual",
  });
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (!cookies.some((c) => c.startsWith("sb-"))) throw new Error(`Demo login failed for ${email} (HTTP ${res.status}); is NEXT_PUBLIC_DEMO_LOGIN_HINTS=true on the server?`);
  const jar = cookies.join("; ");
  jars.set(email, jar);
  return jar;
}

/** The UI message stream: ok when text arrived and no error chunk did. */
function readChatStream(raw: string): { ok: boolean; error?: string } {
  let text = 0;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const chunk = JSON.parse(line.slice(6)) as { type?: string; errorText?: string };
      if (chunk.type === "error") return { ok: false, error: chunk.errorText };
      if (chunk.type === "text-delta") text++;
    } catch { /* non-JSON keep-alive */ }
  }
  return text > 0 ? { ok: true } : { ok: false, error: "no text in stream" };
}

function category(code: string | undefined, message: string | undefined, usageError: string | null): string {
  const m = `${message ?? ""}`.toLowerCase();
  if (code === "forbidden") return "forbidden";
  if (/turned off|not available for your institution/.test(m)) return "gated";
  if (code === "not_found") return "not_found(input)";
  if (code === "validation_failed") return "bad_input";
  if (code === "quota_exceeded") return "quota";
  if (code === "rate_limited" || /busy/.test(m)) return "rate_limited";
  if (/more school data|too large/.test(m)) return "too_large";
  if (/not set up|not configured/.test(m)) return "not_configured";
  if (code === "ai_invalid_output" || usageError === "ai_invalid_output") return "invalid_output";
  if (/local ai engine/.test(m)) return "local_only(no ollama)";
  return code ?? usageError ?? "unknown";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const recentTokens: { at: number; tokens: number }[] = [];
async function pace(): Promise<void> {
  for (;;) {
    const cutoff = Date.now() - 60_000;
    while (recentTokens.length && recentTokens[0].at < cutoff) recentTokens.shift();
    const used = recentTokens.reduce((s, r) => s + r.tokens, 0);
    if (used + NEXT_CALL_ESTIMATE <= TOKENS_PER_MINUTE_BUDGET || recentTokens.length === 0) return;
    await sleep(recentTokens[0].at + 60_000 - Date.now() + 250);
  }
}

async function usageSince(userEmail: string, since: Date) {
  return sql<{ provider: string; model: string; ok: boolean; error_code: string | null; tokens: number }[]>`
    select e.provider, e.model, e.ok, e.error_code, (e.input_tokens + e.output_tokens)::int as tokens
    from ai_usage_events e join auth.users u on u.id = e.user_id
    where u.email = ${userEmail} and e.created_at >= ${since} order by e.created_at`;
}

async function run(feature: Feature, ids: Ids) {
  await pace();
  const cookie = await cookieFor(feature.email);
  const started = new Date(Date.now() - 1000);
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/ai/${feature.path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, cookie },
    body: JSON.stringify({ institutionSlug: SLUG, ...feature.body(ids) }),
  });
  const raw = await res.text();
  const latency = Date.now() - t0;
  await sleep(300); // chat usage rows are written after the stream closes
  const usage = await usageSince(feature.email, started);
  const tokens = usage.reduce((s, u) => s + u.tokens, 0);
  recentTokens.push({ at: Date.now(), tokens: Math.max(tokens, 500) });
  const lastUsage = usage.at(-1) ?? null;
  const usageFailure = usage.find((u) => !u.ok)?.error_code ?? null;

  let ok = false;
  let shape = "-";
  let err: string | undefined;
  let modelShown = lastUsage ? `${lastUsage.provider}:${lastUsage.model}` : "-";
  if (feature.chat) {
    const stream = res.ok ? readChatStream(raw) : { ok: false, error: raw.slice(0, 300) };
    ok = stream.ok;
    shape = stream.ok ? "stream" : "-";
    if (!stream.ok) {
      try { const env = JSON.parse(stream.error ?? "") as { error?: { code?: string; message?: string } }; err = category(env.error?.code, env.error?.message, usageFailure); }
      catch { err = category(undefined, stream.error, usageFailure); }
    }
  } else {
    let env: { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } } = {};
    try { env = JSON.parse(raw); } catch { err = `non_json(${raw.slice(0, 60).replace(/\s+/g, " ")})`; }
    if (env.ok) {
      const parsed = feature.output ? feature.output.safeParse(env.data) : { success: true };
      shape = parsed.success ? "ok" : "MISMATCH";
      ok = parsed.success && !usageFailure;
      if (typeof env.data?.provider === "string") modelShown = `${env.data.provider}:${String(env.data.model ?? "")}`;
      if (!ok) err = usageFailure ? `silent_fallback(${usageFailure})` : `shape(${JSON.stringify(parsed.success ? "" : (parsed as { error: z.ZodError }).error.issues[0]?.path)})`;
    } else if (!err) {
      err = category(env.error?.code, env.error?.message, usageFailure);
    }
  }
  if (feature.expectError) ok = err === feature.expectError;
  return { ok, status: res.status, modelShown, shape, latency, err, tokens };
}

async function main() {
  const only = args.only ? new Set((args.only as string).split(",").map((s) => s.trim())) : null;
  const ids = await lookups();
  const list = FEATURES.filter((f) => !only || only.has(f.name));
  console.log(`AI smoke against ${BASE} (${SLUG}), ${list.length} features`);
  console.log(["feature".padEnd(32), "role/user".padEnd(36), "http", "result", "provider:model".padEnd(48), "shape".padEnd(8), "ms".padStart(6), "tokens".padStart(6), "error"].join(" "));
  let passed = 0;
  for (const [n, feature] of list.entries()) {
    if (n > 0) await sleep(GAP_MS);
    try {
      const r = await run(feature, ids);
      if (r.ok) passed++;
      console.log([feature.name.padEnd(32), feature.email.padEnd(36), String(r.status).padEnd(4), (r.ok ? "PASS" : "FAIL").padEnd(6),
        r.modelShown.slice(0, 48).padEnd(48), r.shape.padEnd(8), String(r.latency).padStart(6), String(r.tokens).padStart(6), r.err ?? ""].join(" "));
    } catch (e) {
      console.log(`${feature.name.padEnd(32)} ${feature.email.padEnd(36)} ERROR  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`${passed}/${list.length} passed`);
  await sql.end();
  process.exit(passed === list.length ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await sql.end().catch(() => {});
  process.exit(1);
});
