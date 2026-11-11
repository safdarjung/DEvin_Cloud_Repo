// features-18 §C — the four draft routes with the REAL gateway (runStructured)
// and mocked model/provider factories (lab-scenario-route.test.ts pattern).
// Owner queries are mocked: each test feeds what the caller's RLS would
// return, so "another school's id" is an id the owner query does not return.
// Per route: permission denial, out-of-scope/cross-tenant id refused before
// any model call, local_only never builds a cloud provider (cloud keys set),
// PII allow-list for #3/#4, and nothing written but usage (no Supabase
// client, no save action).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";

const m = vi.hoisted(() => ({
  generateText: vi.fn(),
  getTenantContext: vi.fn(),
  createClient: vi.fn(),
  logUsage: vi.fn(async () => {}),
  listSectionSubjects: vi.fn(),
  listCurriculumUnits: vi.fn(),
  curriculumSectionUnits: vi.fn(),
  listTeachingPairs: vi.fn(),
  listQuestions: vi.fn(),
  listDefaulters: vi.fn(),
  listTermOptions: vi.fn(),
  getStudentProfile: vi.fn(),
  getCurrentTermId: vi.fn(),
  getStudentAttendanceSummary: vi.fn(),
  listResultsForStudent: vi.fn(),
  getCurrentResult: vi.fn(),
  mySubmissions: vi.fn(),
  portalTimeline: vi.fn(),
  upsertLessonPlan: vi.fn(),
  createQuestion: vi.fn(),
  sendFeeReminders: vi.fn(),
  sendInvoiceReminders: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: (...args: unknown[]) => m.generateText(...args) };
});
vi.mock("@/lib/ai/providers", () => ({
  getLocalModel: vi.fn(() => "local-model-handle"),
  getCloudModel: vi.fn(async () => "cloud-model-handle"),
  localModelId: vi.fn(() => "qwen3:4b-instruct-2507-q4_K_M"),
  cloudModelId: vi.fn(() => "claude-sonnet-5"),
  getGeminiModel: vi.fn(async () => "gemini-model-handle"),
  geminiModelId: vi.fn(() => "gemini-flash-lite-latest"),
  getGroqModel: vi.fn(async () => "groq-model-handle"),
  groqModelId: vi.fn(() => "openai/gpt-oss-120b"),
}));
vi.mock("@/lib/ai/usage", () => ({
  checkLimits: vi.fn(async () => ({ ok: true })),
  logUsage: m.logUsage,
  acquireConcurrencySlot: vi.fn(() => true),
  releaseConcurrencySlot: vi.fn(() => {}),
  aiSettingsFor: vi.fn(() => ({ daily_token_quota: 200000, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4 })),
}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: m.getTenantContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.createClient, getClaims: vi.fn() }));
vi.mock("@/modules/academics/assignments.queries", () => ({
  listSectionSubjects: m.listSectionSubjects,
  listCurriculumUnits: m.listCurriculumUnits,
}));
vi.mock("@/modules/academics/curriculum.queries", () => ({ curriculumSectionUnits: m.curriculumSectionUnits }));
vi.mock("@/modules/question-bank/queries", () => ({ listTeachingPairs: m.listTeachingPairs, listQuestions: m.listQuestions }));
vi.mock("@/modules/finance/queries", () => ({ listDefaulters: m.listDefaulters, listTermOptions: m.listTermOptions }));
vi.mock("@/modules/people/queries", () => ({ getStudentProfile: m.getStudentProfile, getCurrentTermId: m.getCurrentTermId }));
vi.mock("@/modules/attendance/queries", () => ({ getStudentAttendanceSummary: m.getStudentAttendanceSummary }));
vi.mock("@/modules/exams/queries", () => ({ listResultsForStudent: m.listResultsForStudent, getCurrentResult: m.getCurrentResult }));
vi.mock("@/modules/academics/submissions.queries", () => ({ mySubmissions: m.mySubmissions }));
vi.mock("@/modules/behaviour/queries", () => ({ portalTimeline: m.portalTimeline }));
vi.mock("@/modules/academics/curriculum.actions", () => ({ upsertLessonPlan: m.upsertLessonPlan }));
vi.mock("@/modules/question-bank/actions", () => ({ createQuestion: m.createQuestion }));
vi.mock("@/modules/finance/reminders.actions", () => ({
  sendFeeReminders: m.sendFeeReminders,
  sendInvoiceReminders: m.sendInvoiceReminders,
}));

const providers = await import("@/lib/ai/providers");
const lessonPlan = await import("@/app/api/ai/lesson-plan/route");
const questionPaper = await import("@/app/api/ai/question-paper/route");
const feeReminder = await import("@/app/api/ai/fee-reminder-draft/route");
const ptmBrief = await import("@/app/api/ai/ptm-brief/route");

const SECTION = crypto.randomUUID();
const SUBJECT = crypto.randomUUID();
const GRADE = crypto.randomUUID();
const UNIT = crypto.randomUUID();
const UNIT_2 = crypto.randomUUID();
const FOREIGN = crypto.randomUUID();
const INVOICE = crypto.randomUUID();
const TERM = crypto.randomUUID();
const STUDENT = crypto.randomUUID();

function fakeCtx(role: Role, modules: Record<string, boolean> = {}): TenantContext {
  return {
    institution: {
      id: "inst-1",
      slug: "demo",
      name: "Demo School",
      settings: { modules: { ...allModulesOn(), ...modules } },
      ai_policy: "local_only",
      is_demo: false,
    },
    user: { id: "user-1", profile: { fullName: "Test", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function modelReturns(output: unknown) {
  m.generateText.mockResolvedValueOnce({ output, usage: { inputTokens: 10, outputTokens: 20 } });
}

/** The full text the model received (instructions + prompt). */
function sentToModel(): string {
  const call = m.generateText.mock.calls[0][0] as { instructions: string; prompt: string };
  return `${call.instructions}\n${call.prompt}`;
}

function expectLocalOnlyAndNoWrites() {
  expect(providers.getLocalModel).toHaveBeenCalled();
  expect(providers.getCloudModel).not.toHaveBeenCalled();
  expect(providers.getGroqModel).not.toHaveBeenCalled();
  expect(providers.getGeminiModel).not.toHaveBeenCalled();
  const call = m.generateText.mock.calls[0][0] as { maxOutputTokens: number };
  expect(call.maxOutputTokens).toBeGreaterThan(0);
  expectNoWrites();
  expect(m.logUsage).toHaveBeenCalledTimes(1); // usage is the only write
}

function expectNoWrites() {
  expect(m.createClient).not.toHaveBeenCalled();
  for (const action of [m.upsertLessonPlan, m.createQuestion, m.sendFeeReminders, m.sendInvoiceReminders]) {
    expect(action).not.toHaveBeenCalled();
  }
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "test-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.AI_CLOUD_ENABLED = "true";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---------------------------------------------------------------- #15
describe("POST /api/ai/lesson-plan", () => {
  const body = { institutionSlug: "demo", classSectionId: SECTION, subjectId: SUBJECT, curriculumUnitId: UNIT, periods: 2, notes: "Use the number line." };
  const draft = { objectives: "Add like fractions.", periods: ["Intro", "Practice"], activities: "Pair work.", assessment: "Exit ticket.", homework: "Worksheet 3." };

  function inScope() {
    m.listSectionSubjects.mockResolvedValue([{ id: SUBJECT, name: "Mathematics" }]);
    m.curriculumSectionUnits.mockResolvedValue([{ id: UNIT, title: "Fractions", sequence: 1, coveredOn: null }]);
  }

  it("teacher, local_only: unit loaded through the owner queries, draft returned, local model only, nothing saved", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
    inScope();
    modelReturns(draft);

    const res = await lessonPlan.POST(post("/api/ai/lesson-plan", body));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ draft, unitTitle: "Fractions", provider: "local" });
    expect(m.curriculumSectionUnits).toHaveBeenCalledWith(expect.objectContaining({ institution: expect.objectContaining({ id: "inst-1" }) }), {
      classSectionId: SECTION,
      subjectId: SUBJECT,
    });
    expect(sentToModel()).toContain("Fractions");
    expect(sentToModel()).toContain("Use the number line.");
    expectLocalOnlyAndNoWrites();
  });

  it("admin (no assignment.manage) and guardian are forbidden; the model is never called", async () => {
    for (const role of ["admin", "guardian"] as const) {
      m.getTenantContext.mockResolvedValue(fakeCtx(role));
      const res = await lessonPlan.POST(post("/api/ai/lesson-plan", body));
      expect(res.status).toBe(403);
    }
    expect(m.generateText).not.toHaveBeenCalled();
    expect(m.listSectionSubjects).not.toHaveBeenCalled();
  });

  it("a unit the owner query does not return (another school, grade or subject): not_found, no model call", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
    inScope();
    const res = await lessonPlan.POST(post("/api/ai/lesson-plan", { ...body, curriculumUnitId: FOREIGN }));
    expect(res.status).toBe(404);
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("a subject the teacher does not teach in the section: not_found before loading units", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
    m.listSectionSubjects.mockResolvedValue([]);
    const res = await lessonPlan.POST(post("/api/ai/lesson-plan", body));
    expect(res.status).toBe(404);
    expect(m.curriculumSectionUnits).not.toHaveBeenCalled();
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("capability turned off for the role: ai_unavailable", async () => {
    const ctx = fakeCtx("teacher");
    m.getTenantContext.mockResolvedValue({
      ...ctx,
      institution: { ...ctx.institution, settings: { ...ctx.institution.settings, ai_roles: { teacher: { capabilities: { lesson_plan_writer: false } } } } },
    });
    const res = await lessonPlan.POST(post("/api/ai/lesson-plan", body));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("ai_unavailable");
    expect(m.generateText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- #16
describe("POST /api/ai/question-paper", () => {
  const body = {
    institutionSlug: "demo",
    gradeId: GRADE,
    subjectId: SUBJECT,
    totalMarks: 14,
    rows: [
      { curriculumUnitId: UNIT, difficulty: "easy", marks: 2, count: 2 },
      { curriculumUnitId: UNIT_2, difficulty: "hard", marks: 5, count: 2 },
    ],
  };
  const bankQ = (id: string, marks: number, unit = UNIT) => ({
    id,
    curriculumUnitId: unit,
    difficulty: "easy",
    type: "short_answer",
    body: `Bank question ${id}`,
    options: null,
    answer: "secret answer",
    marks,
  });

  function inScope() {
    m.listTeachingPairs.mockResolvedValue([{ gradeId: GRADE, gradeCode: "VI", subjectId: SUBJECT, subjectName: "Science" }]);
    m.listCurriculumUnits.mockResolvedValue([
      { id: UNIT, title: "Plants", sequence: 1 },
      { id: UNIT_2, title: "Magnets", sequence: 2 },
    ]);
  }

  it("picks matching bank questions first (stable id order) and sends only the unfilled slots to the model as drafts", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
    inScope();
    m.listQuestions
      .mockResolvedValueOnce({ items: [bankQ("b", 2), bankQ("a", 2), bankQ("c", 3)], total: 3 }) // row 1: 2 matches at 2 marks
      .mockResolvedValueOnce({ items: [], total: 0 }); // row 2: bank empty → 2 AI slots
    modelReturns({
      questions: [
        { type: "mcq", body: "Which pole attracts?", options: ["North", "South"], answer: "North" },
        { type: "long_answer", body: "Explain magnetism.", options: ["ignored"], answer: "Domains align." },
      ],
    });

    const res = await questionPaper.POST(post("/api/ai/question-paper", body));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.picked.map((q: { id: string }) => q.id)).toEqual(["a", "b"]);
    expect(data.picked[0]).not.toHaveProperty("answer");
    expect(data.drafts).toHaveLength(2);
    expect(data.drafts[0]).toMatchObject({ gradeId: GRADE, subjectId: SUBJECT, curriculumUnitId: UNIT_2, difficulty: "hard", marks: 5, type: "mcq" });
    expect(data.drafts[1].options).toEqual([]); // only MCQ keeps options
    expect(data.unfilled).toBe(0);
    expect(m.listQuestions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ curriculumUnitId: UNIT, difficulty: "easy", includeArchived: false }));
    const sent = sentToModel();
    expect(sent).toContain("Slot 2:");
    expect(sent).not.toContain("Slot 3:");
    expect(sent).not.toContain("secret answer");
    expectLocalOnlyAndNoWrites();
  });

  it("every slot filled from the bank: the model is never called", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("owner"));
    inScope();
    m.listQuestions
      .mockResolvedValueOnce({ items: [bankQ("a", 2), bankQ("b", 2)], total: 2 })
      .mockResolvedValueOnce({ items: [bankQ("c", 5, UNIT_2), bankQ("d", 5, UNIT_2)], total: 2 });

    const res = await questionPaper.POST(post("/api/ai/question-paper", body));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ drafts: [], unfilled: 0, provider: null });
    expect(data.picked).toHaveLength(4);
    expect(m.generateText).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("a unit that is not in this grade/subject (another school's id): not_found, no bank read, no model call", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
    inScope();
    const res = await questionPaper.POST(
      post("/api/ai/question-paper", { ...body, totalMarks: 4, rows: [{ curriculumUnitId: FOREIGN, difficulty: "easy", marks: 2, count: 2 }] }),
    );
    expect(res.status).toBe(404);
    expect(m.listQuestions).not.toHaveBeenCalled();
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("a grade/subject the caller does not teach: not_found, no model call", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
    m.listTeachingPairs.mockResolvedValue([]);
    const res = await questionPaper.POST(post("/api/ai/question-paper", body));
    expect(res.status).toBe(404);
    expect(m.listCurriculumUnits).not.toHaveBeenCalled();
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("student is forbidden; exam_controller (no ai.generate) gets ai_unavailable", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("student"));
    expect((await questionPaper.POST(post("/api/ai/question-paper", body))).status).toBe(403);
    m.getTenantContext.mockResolvedValue(fakeCtx("exam_controller"));
    expect((await questionPaper.POST(post("/api/ai/question-paper", body))).status).toBe(502);
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("model failure still returns the bank picks with the gaps counted as unfilled", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
    inScope();
    m.listQuestions.mockResolvedValueOnce({ items: [bankQ("a", 2), bankQ("b", 2)], total: 2 }).mockResolvedValueOnce({ items: [], total: 0 });
    m.generateText.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const res = await questionPaper.POST(post("/api/ai/question-paper", body));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ drafts: [], unfilled: 2, provider: null });
    expect(data.picked).toHaveLength(2);
    expect(data.aiNote).toMatch(/not reachable/);
  });
});

// ---------------------------------------------------------------- #17
describe("POST /api/ai/fee-reminder-draft", () => {
  const body = { institutionSlug: "demo", invoiceId: INVOICE, termId: TERM };
  const defaulter = {
    studentId: STUDENT,
    studentName: "Aarav Kapoor",
    invoiceId: INVOICE,
    invoiceNo: "INV-0042",
    total: 15000,
    paidTotal: 2500,
    outstanding: 12500,
    dueOn: "2026-10-01",
    onPlan: false,
  };
  const profile = {
    id: STUDENT,
    admissionNo: "ADM-7731",
    firstName: "Aarav",
    lastName: "Kapoor",
    dob: "2014-03-09",
    gender: "male",
    status: "active",
    enrolment: null,
    guardians: [
      { id: "g1", fullName: "Meena Kapoor", phone: "+919876543210", email: "meena@example.com", relationship: "mother", isPrimary: true, hasPortalLogin: true },
      { id: "g2", fullName: "Rohit Kapoor", phone: "+919812345678", email: null, relationship: "father", isPrimary: false, hasPortalLogin: false },
    ],
  };

  function inScope() {
    m.listDefaulters.mockResolvedValue([defaulter]);
    m.listTermOptions.mockResolvedValue([{ id: TERM, label: "Term 1" }]);
    m.getStudentProfile.mockResolvedValue(profile);
  }

  it("principal: prompt holds amount/due/term only — no names, phone, email or admission no; names filled in afterwards", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("principal"));
    inScope();
    modelReturns({
      callScript: "Hello {guardianName}, calling about {studentName}'s Term 1 fee.",
      sms: "Dear {guardianName}, {studentName}'s fee is overdue.",
      whatsapp: "Namaste {guardianName} 🙏 a gentle reminder for {studentName}.",
    });

    const res = await feeReminder.POST(post("/api/ai/fee-reminder-draft", body));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sms).toBe("Dear Meena, Aarav's fee is overdue.");
    expect(data.callScript).toContain("Hello Meena");
    expect(data.whatsapp).toContain("Aarav");
    const sent = sentToModel();
    expect(sent).toContain("12,500");
    expect(sent).toContain("Term 1");
    expect(sent).toContain("2026-10-01");
    for (const pii of ["Aarav", "Kapoor", "Meena", "Rohit", "9876543210", "9812345678", "meena@example.com", "ADM-7731", "2014-03-09", "INV-0042"]) {
      expect(sent).not.toContain(pii);
    }
    expectLocalOnlyAndNoWrites();
  });

  it("teacher and guardian (no finance.structure.manage) are forbidden; no finance read, no model call", async () => {
    for (const role of ["teacher", "guardian"] as const) {
      m.getTenantContext.mockResolvedValue(fakeCtx(role));
      expect((await feeReminder.POST(post("/api/ai/fee-reminder-draft", body))).status).toBe(403);
    }
    expect(m.listDefaulters).not.toHaveBeenCalled();
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("an invoice that is not an open invoice of this school's term: not_found, student never read, no model call", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("admin"));
    inScope();
    const res = await feeReminder.POST(post("/api/ai/fee-reminder-draft", { ...body, invoiceId: FOREIGN }));
    expect(res.status).toBe(404);
    expect(m.getStudentProfile).not.toHaveBeenCalled();
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("accountant (finance.structure.manage but no ai.generate): ai_unavailable", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("accountant"));
    const res = await feeReminder.POST(post("/api/ai/fee-reminder-draft", body));
    expect(res.status).toBe(502);
    expect(m.generateText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- #18
describe("POST /api/ai/ptm-brief", () => {
  const body = { institutionSlug: "demo", studentId: STUDENT };
  const profile = {
    id: STUDENT,
    admissionNo: "ADM-5521",
    firstName: "Isha",
    lastName: "Verma",
    dob: "2013-07-21",
    gender: "female",
    status: "active",
    enrolment: { id: "e1", classSectionId: SECTION, sectionName: "A", gradeName: "Grade VI", rollNo: 7, academicYearId: "ay-1", status: "active" },
    guardians: [{ id: "g1", fullName: "Sunita Verma", phone: "+919800011122", email: null, relationship: "mother", isPrimary: true, hasPortalLogin: true }],
  };
  const brief = { strengths: ["Strong in maths."], concerns: ["Two overdue tasks."], talkingPoints: ["a", "b", "c"], nextSteps: ["x", "y"] };

  function readable() {
    m.getStudentProfile.mockResolvedValue(profile);
    m.getCurrentTermId.mockResolvedValue(TERM);
    m.getStudentAttendanceSummary.mockResolvedValue({ studentId: STUDENT, termId: TERM, percentage: 82.5, presentWeighted: 33, totalInDenominator: 40, thresholds: { warn: 85, critical: 75 } });
    m.listResultsForStudent.mockResolvedValue([{ examId: "ex-1", examName: "Half-Yearly", examType: "term", total: 350, maxTotal: 500, percentage: 70, grade: "B", publishedAt: "2026-10-20" }]);
    m.getCurrentResult.mockResolvedValue({
      examName: "Half-Yearly",
      percentage: 70,
      grade: "B",
      studentName: "Isha Verma",
      admissionNo: "ADM-5521",
      subjects: [{ examPaperId: "p1", subjectId: SUBJECT, subjectName: "Mathematics", marksObtained: 88, maxMarks: 100, isAbsent: false, passed: true, grade: "A" }],
    });
    m.mySubmissions.mockResolvedValue([
      { assignmentId: "as1", title: "Fractions worksheet", subjectId: SUBJECT, dueAt: "2026-11-01T00:00:00Z", state: "not_submitted", isLate: true },
      { assignmentId: "as2", title: "Essay", subjectId: SUBJECT, dueAt: "2026-11-20T00:00:00Z", state: "submitted", isLate: false },
    ]);
    m.portalTimeline.mockResolvedValue({
      incidents: [
        { id: "i1", category: "merit", severity: "low", points: 5, note: "Helped classmate with asthma inhaler", occurredOn: "2026-10-02" },
        { id: "i2", category: "late", severity: "low", points: -2, note: "Late after hospital visit", occurredOn: "2026-10-05" },
      ],
      total: 3,
    });
  }

  it("teacher: attendance, latest marks by subject, pending work and behaviour points — no identity, contact, notes or health", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
    readable();
    modelReturns(brief);

    const res = await ptmBrief.POST(post("/api/ai/ptm-brief", body));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ brief, provider: "local" });
    const sent = sentToModel();
    expect(sent).toContain("82.5");
    expect(sent).toContain("Mathematics: 88/100");
    expect(sent).toContain("Fractions worksheet");
    expect(sent).toMatch(/merit 5, demerit -2/);
    expect(sent).not.toContain("Essay"); // submitted work is not pending
    for (const pii of ["Isha", "Verma", "Sunita", "9800011122", "ADM-5521", "2013-07-21", "female", "asthma", "hospital", "inhaler"]) {
      expect(sent).not.toContain(pii);
    }
    expect(m.portalTimeline).toHaveBeenCalledWith(expect.anything(), STUDENT);
    expectLocalOnlyAndNoWrites();
  });

  it("behaviour module off: behaviour is never read or sent", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher", { behaviour: false }));
    readable();
    modelReturns(brief);

    const res = await ptmBrief.POST(post("/api/ai/ptm-brief", body));

    expect(res.status).toBe(200);
    expect(m.portalTimeline).not.toHaveBeenCalled();
    expect(sentToModel()).not.toMatch(/Behaviour points/);
  });

  it("guardian and student cannot call it", async () => {
    for (const role of ["guardian", "student"] as const) {
      m.getTenantContext.mockResolvedValue(fakeCtx(role));
      expect((await ptmBrief.POST(post("/api/ai/ptm-brief", body))).status).toBe(403);
    }
    expect(m.getStudentProfile).not.toHaveBeenCalled();
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("a student the caller may not read (another school, or not taught): not_found, nothing else read, no model call", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
    m.getStudentProfile.mockResolvedValue(null);
    const res = await ptmBrief.POST(post("/api/ai/ptm-brief", { ...body, studentId: FOREIGN }));
    expect(res.status).toBe(404);
    expect(m.listResultsForStudent).not.toHaveBeenCalled();
    expect(m.mySubmissions).not.toHaveBeenCalled();
    expect(m.generateText).not.toHaveBeenCalled();
  });
});
