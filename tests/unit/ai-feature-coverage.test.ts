// features-18 §E — every feature a role has enabled is in its Orb and reachable
// by the AI agent under that role's own permissions. Pins: the reviewed list of
// cloud-safe (aggregate) queries, the never-listed queries, the draft deny-list,
// registry existence, per-caller permission gating, and per-role Orb coverage.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action } from "@/lib/actions/define-action";
import { getRegisteredQueries } from "@/lib/actions/define-query";
import { getRegisteredActions } from "@/lib/actions/registry";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { navItemsFor } from "@/lib/nav";
import { buildReadTools } from "@/modules/agents/tools";
import { ASSISTANT_QUERIES } from "@/modules/ai/assistant/catalog";
import { CAPABILITIES, CAPABILITY_KEYS, DRAFTABLE_ACTIONS } from "@/modules/ai/capabilities/catalog";
import { enabledCapabilities } from "@/modules/ai/capabilities/resolve";
import { orbChips } from "@/modules/ai/components/orb/orb-chips";
import { buildDraftTools } from "@/modules/ai/kernel/draft-tools";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

afterEach(() => vi.restoreAllMocks());

const ROLES: Role[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"];

function ctxFor(role: Role): TenantContext {
  return {
    institution: {
      id: "inst-1",
      slug: "cov",
      name: "Coverage",
      settings: { modules: allModulesOn(), features: { student_ai_study: true }, ai_roles: { [role]: { enabled: true } } },
      ai_policy: "local_only",
      is_demo: false,
    },
    user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", guardianId: "guardian-1", studentId: "student-1" },
    permissions: new Set(permissionsFor(role)),
  };
}

// Reviewed by hand: each return shape read and found free of names, person ids,
// contact data and free text by or about a person. Adding an aggregate query
// means reading its shape and adding it here.
const REVIEWED_AGGREGATES = [
  "attendance.attendanceTodaySummary",
  "attendance.todayBySection",
  "people.enrolmentCounts",
  "finance.listTermOptions",
  "finance.defaulterCounts",
  "attendance.sectionsBelowThreshold",
  "dashboard.attendanceTrend",
  "exams.listExams",
  "exams.examGradeDistribution",
  "exams.listSubjectOptions",
  "exams.listSectionOptions",
  "exams.listTermOptions",
  "mastery.heatmapBySection",
  "curriculum.coverageBySection",
  "timetable.roomUtilisation",
  "finance.termCollectionSummary",
  "finance.collectionReport",
  "admissions.getAdmissionsFunnelCounts",
  "calendar.forRole",
  "insights.riskIndicators",
  "forecasts.cards",
  "website.listNotices",
  // features-18 §E
  "clubs.houseLeaderboard",
  "expenses.categories",
  "expenses.monthlyTotals",
  "expenses.budgetVsActual",
  "inventory.stock",
  "inventory.lowStockCount",

  "canteen.items",
  "canteen.daySales",
  "hostel.rooms",



  "schoolLabs.labs",
  "schoolLabs.utilisation",
  "schoolLabs.safetyWarnings",
  "achievements.summary",
  "resources.summary",
  "duties.types",
  "duties.countByType",
  "compliance.summary",
  "helpdesk.counts",
  "form.results",
  "examSeating.slots",
  "feePlans.lateFeeRules",
  "lab.correlation",
  "lab.anomalies",
  "lab.feeRisk",
  "lab.trendBreaks",
];

// Never offered to any model, local or cloud.
const NEVER_LISTED = [
  /^health\./,
  /^behaviour\.(incidents|timeline)$/,
  /^helpdesk\.(thread|myThread)$/,
  /^payroll\.(structures|run|myPayslips|payslip)$/,
  /^scholarships\.awards$/,
  /^canteen\.statement$/,
  /^safety\.pendingAcknowledgements$/,
  /^alumni\.list$/,
  /^core\.setup\./,
  /^documents?\./,
  /Html$/,
  /ledgerExport$/,
];

// No draft for money moves, payroll, concession decisions, marks/results,
// membership/roles/permissions, health, behaviour, hostel allocation, safety,
// duty rosters/swaps, or void/verify/publish/finalize/renew/starter/setup/invite.
const DRAFT_DENY = [
  /payment/i,
  /receipt/i,
  /payroll/i,
  /payslip/i,
  /canteen\.topup/i,
  /canteen\.purchase/i,
  /concession.*decide|award\.decide/i,
  /marks?\b|\.marks/i,
  /result/i,
  /member/i,
  /permission/i,
  /role/i,
  /health/i,
  /behaviour/i,
  /hostel\.allocate/i,
  /safety/i,
  /duty\.roster|duties\.roster/i,
  /duty\.swap|duties\.swap/i,
  /void/i,
  /verify/i,
  /publish/i,
  /finali[sz]e/i,
  /renew/i,
  /starter/i,
  /setup/i,
  /invite/i,
];

async function loadRegistries(): Promise<void> {
  await import("@/app/api/v1/query/all-queries");
  await import("@/app/api/v1/actions/all-actions");
}

describe("ASSISTANT_QUERIES — cloud exposure", () => {
  it("the aggregate (cloud-safe) set is exactly the hand-reviewed list", () => {
    const aggregates = Object.entries(ASSISTANT_QUERIES).filter(([, s]) => s.aggregate).map(([n]) => n);
    expect([...aggregates].sort()).toEqual([...REVIEWED_AGGREGATES].sort());
  });

  it("never lists health, incident text, message bodies, payslips, awards, statements, pending names, alumni contacts or setup internals", () => {
    const listed = [...Object.keys(ASSISTANT_QUERIES), ...Object.values(CAPABILITIES).flatMap((c) => c.queries ?? [])];
    for (const name of listed) for (const pattern of NEVER_LISTED) expect(name).not.toMatch(pattern);
  });

  it("every listed query and every capability query is a registered query", async () => {
    await loadRegistries();
    const registered = getRegisteredQueries();
    const names = new Set([...Object.keys(ASSISTANT_QUERIES), ...Object.values(CAPABILITIES).flatMap((c) => c.queries ?? [])]);
    expect([...names].filter((n) => !registered.has(n))).toEqual([]);
  });

  it("every capability query has its own one-line description", () => {
    const missing = Object.values(CAPABILITIES)
      .flatMap((c) => c.queries ?? [])
      .filter((n) => !ASSISTANT_QUERIES[n] && !["academics.listCurriculumUnits", "diary.forStudent", "exams.getMyPapers", "questionBank.paperDraft", "academics.gradeSuggestions", "exams.markOutliers"].includes(n));
    expect(missing).toEqual([]);
  });
});

describe("DRAFTABLE_ACTIONS — human-confirmed writes only", () => {
  it("no draftable action matches the deny-list", () => {
    for (const action of DRAFTABLE_ACTIONS) for (const pattern of DRAFT_DENY) expect(action, `${action} vs ${pattern}`).not.toMatch(pattern);
  });

  it("every draftable action is a registered action and every capability draft is allow-listed", async () => {
    await loadRegistries();
    expect(DRAFTABLE_ACTIONS.filter((a) => !getRegisteredActions().has(a))).toEqual([]);
    for (const cap of Object.values(CAPABILITIES)) for (const a of cap.drafts ?? []) expect(DRAFTABLE_ACTIONS).toContain(a);
  });

  it("a draft tool returns a draft for the person to save and never runs the action", async () => {
    await loadRegistries();
    const real = getRegisteredActions().get("helpdesk.message.reply")!;
    const spy = vi.fn(real);
    const realGet = Map.prototype.get;
    vi.spyOn(getRegisteredActions() as Map<string, typeof real>, "get").mockImplementation(function (this: Map<string, typeof real>, key: string) {
      return key === "helpdesk.message.reply" ? spy : realGet.call(this, key);
    });
    const tools = await buildDraftTools(ctxFor("admin"), [CAPABILITIES.helpdesk_overview]);
    const draft = tools.draft_helpdesk_message_reply;
    expect(draft).toBeDefined();
    const out = await draft!.execute!({ ticketId: "00000000-0000-4000-8000-000000000001", body: "We are checking the bus route." } as never, {
      toolCallId: "c1",
      messages: [],
      context: {} as never,
    });
    expect(out).toMatchObject({ kind: "action_draft", action: "helpdesk.message.reply", input: { body: "We are checking the bus route." } });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("per-caller gating (the registry re-checks permission per call)", () => {
  const MANAGER_ONLY = ["helpdesk.tickets", "helpdesk.counts", "payroll.monthlyCost", "expenses.list", "form.results", "library.overdue", "visitors.list", "workflows.list", "hostel.rooms", "compliance.summary", "inventory.stock"];

  it("a teacher's agent gets no tool for a manager-only query, even when a catalog names it", async () => {
    const catalog = Object.fromEntries(Object.values(CAPABILITIES).flatMap((c) => c.queries ?? []).map((n) => [n, n]));
    const { registryNameOf } = await buildReadTools(ctxFor("teacher"), catalog, "nonce");
    const names = new Set(registryNameOf.values());
    for (const q of MANAGER_ONLY) expect(names.has(q), q).toBe(false);
    for (const q of ["schoolLabs.labs", "clubs.houseLeaderboard", "duties.types", "achievements.summary"]) expect(names.has(q), q).toBe(true);
  });

  it("a teacher calling a manager-only registered query directly is forbidden before any read", async () => {
    await loadRegistries();
    // No acting Supabase client is set: reaching a handler would throw, so "forbidden" proves the gate ran first.
    for (const q of ["helpdesk.tickets", "helpdesk.counts", "payroll.monthlyCost", "payroll.runs", "hostel.rooms", "compliance.summary", "inventory.stock", "expenses.categories", "alumni.counts"]) {
      const query = getRegisteredQueries().get(q) as Action<unknown>;
      const res = await query("cov", {}, ctxFor("teacher"));
      expect(res.ok ? "ok" : res.error.code, q).toBe("forbidden");
    }
  });

  it("a teacher gets draft tools only for actions they hold (lab booking yes, helpdesk reply and expenses no)", async () => {
    const tools = await buildDraftTools(ctxFor("teacher"), Object.values(CAPABILITIES));
    expect(tools.draft_schoolLabs_booking_book).toBeDefined();
    expect(tools.draft_achievement_record).toBeDefined();
    expect(tools.draft_helpdesk_message_reply).toBeUndefined();
    expect(tools.draft_expenses_record).toBeUndefined();
    expect(tools.draft_library_loan_issue).toBeUndefined();
  });
});

describe("Orb coverage per role", () => {
  const APP_DIR = path.join(process.cwd(), "src", "app", "(tenant)", "[institution]");
  // Page tasks that also run in chat, so a chat chip is a real entry point.
  const CHAT_OK_TASKS = ["translate"];

  it.each(ROLES)("%s: every nav item has a page, and every enabled capability has a chip", (role) => {
    const ctx = ctxFor(role);
    const apps = navItemsFor(ctx.permissions, ctx.institution.settings, false, role);
    const noPage = apps.map((a) => a.href).filter((href) => !fs.existsSync(path.join(APP_DIR, ...href.split("/").filter(Boolean), "page.tsx")));
    expect(noPage).toEqual([]);

    const keys = enabledCapabilities(ctx, role);
    const appHrefs = apps.map((a) => `/cov${a.href}`);
    const withChat = orbChips(keys, { slug: "cov", appHrefs, chatOn: true });
    expect(withChat.map((c) => c.key).sort()).toEqual([...keys].sort());
    for (const chip of withChat) expect(chip.prompt ?? chip.href, chip.key).toBeTruthy();

    // A page task must open its page from the role's own nav, chat on or off.
    const noChat = new Set(orbChips(keys, { slug: "cov", appHrefs, chatOn: false }).map((c) => c.key));
    const tasksWithoutLink = keys.filter((k) => CAPABILITIES[k].kind === "task" && !CHAT_OK_TASKS.includes(k) && !noChat.has(k));
    expect(tasksWithoutLink).toEqual([]);
  });

  it("every capability key is reachable by at least one role", () => {
    const reached = new Set(ROLES.flatMap((r) => enabledCapabilities(ctxFor(r), r)));
    const legacyGated = ["study_visuals", "study_notebook"];
    expect(CAPABILITY_KEYS.filter((k) => !reached.has(k) && !legacyGated.includes(k))).toEqual([]);
  });
});
