// M25-T9 — acceptance over HTTP: real `/api/v1/actions/*` and
// `/api/v1/query/*` route handlers (bearer-token pattern, mirrors
// tests/db/timetable-acceptance.test.ts) for `briefing.generate`,
// `briefings.today`, `core.module.set` and `timetable.suggest` +
// `timetable.saveDraft`; plus a read-only `buildBriefing` check against the
// already-seeded demo tenant (no write — rulings "Seeded tenant, read-only").
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { POST as queryPost } from "@/app/api/v1/query/[name]/route";
import { POST as briefingRoutePost } from "@/app/api/ai/dashboard-briefing/route";
import { withBearerToken } from "@/lib/supabase/server";
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import { buildBriefing } from "@/modules/insights/briefings";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { buildDemoContext, closeDemoHelper } from "../helpers/demo-context";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

function jsonRequest(url: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(jsonRequest(`http://localhost/api/v1/actions/${name}`, body, headers), {
    params: Promise.resolve({ name }),
  });
}

function dispatchQuery(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return queryPost(jsonRequest(`http://localhost/api/v1/query/${name}`, body, headers), {
    params: Promise.resolve({ name }),
  });
}

async function tokenFor(inst: TestInstitution, role: Parameters<TestInstitution["clientAs"]>[0]): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function briefingRowCount(institutionId: string, role: string): Promise<number> {
  const rows = await sql`select 1 from public.briefings where institution_id = ${institutionId}::uuid and role = ${role}`;
  return rows.length;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeDemoHelper();
  await closeRolesHelper();
});

describe("M25-T9 briefings + timetable.suggest acceptance over HTTP", () => {
  it(
    "principal generate links >=3 real sources; owner shares the row; teacher/guardian briefs; " +
      "ai_briefings module off/on; admin timetable.suggest + saveDraft; teacher forbidden",
    async () => {
      const inst = await createTestInstitution("briefings-acceptance");
      try {
        const principalAuth = authHeader(await tokenFor(inst, "principal"));
        const ownerAuth = authHeader(await tokenFor(inst, "owner"));
        const teacherAuth = authHeader(await tokenFor(inst, "teacher"));
        const guardianAuth = authHeader(await tokenFor(inst, "guardian"));
        const adminAuth = authHeader(await tokenFor(inst, "admin"));

        // --- Principal generates; the row links >=3 real, dispatchable sources ---
        const genRes = await dispatchAction("briefing.generate", { institution: inst.slug, input: {} }, principalAuth);
        expect(genRes.status).toBe(200);
        const genBody = await genRes.json();
        expect(genBody.ok).toBe(true);
        const sources = genBody.data.sources as Array<{ query: string; params: unknown }>;
        expect(sources.length).toBeGreaterThanOrEqual(3);

        for (const source of sources) {
          const sourceRes = await dispatchQuery(source.query, { institution: inst.slug, input: source.params }, principalAuth);
          expect(sourceRes.status).toBe(200);
          const sourceBody = await sourceRes.json();
          expect(sourceBody.ok).toBe(true);
        }

        expect(await briefingRowCount(inst.institutionId, "principal")).toBe(1);

        // --- Owner generates: same brief, still one row (owner -> principal brief role) ---
        const ownerRes = await dispatchAction("briefing.generate", { institution: inst.slug, input: {} }, ownerAuth);
        expect(ownerRes.status).toBe(200);
        const ownerBody = await ownerRes.json();
        expect(ownerBody.data).toEqual(genBody.data);
        expect(await briefingRowCount(inst.institutionId, "principal")).toBe(1);

        // --- briefings.today: principal -> equal brief; teacher before generate -> null; ---
        const todayPrincipalRes = await dispatchQuery("briefings.today", { institution: inst.slug, input: {} }, principalAuth);
        expect(todayPrincipalRes.status).toBe(200);
        const todayPrincipalBody = await todayPrincipalRes.json();
        expect(todayPrincipalBody.data).toEqual(genBody.data);

        const teacherBeforeRes = await dispatchQuery("briefings.today", { institution: inst.slug, input: {} }, teacherAuth);
        expect(teacherBeforeRes.status).toBe(200);
        const teacherBeforeBody = await teacherBeforeRes.json();
        expect(teacherBeforeBody.data).toBeNull();

        // --- teacher generates: role teacher, sources subset of {calendar.forRole, exams.schedule} ---
        const teacherGenRes = await dispatchAction("briefing.generate", { institution: inst.slug, input: {} }, teacherAuth);
        expect(teacherGenRes.status).toBe(200);
        const teacherGenBody = await teacherGenRes.json();
        expect(teacherGenBody.data.role).toBe("teacher");
        for (const source of teacherGenBody.data.sources as Array<{ query: string }>) {
          expect(["calendar.forRole", "exams.schedule"]).toContain(source.query);
        }

        // --- guardian: 403 on both names ---
        const guardianGenRes = await dispatchAction("briefing.generate", { institution: inst.slug, input: {} }, guardianAuth);
        expect(guardianGenRes.status).toBe(403);
        const guardianTodayRes = await dispatchQuery("briefings.today", { institution: inst.slug, input: {} }, guardianAuth);
        expect(guardianTodayRes.status).toBe(403);

        // --- ai_briefings module off: both names 403 forbidden MODULE_DISABLED_MESSAGE; route -> ai_unavailable ---
        const disableRes = await dispatchAction(
          "core.module.set",
          { institution: inst.slug, input: { key: "ai_briefings", enabled: false } },
          principalAuth,
        );
        expect(disableRes.status).toBe(200);

        const genOffRes = await dispatchAction("briefing.generate", { institution: inst.slug, input: {} }, principalAuth);
        expect(genOffRes.status).toBe(403);
        const genOffBody = await genOffRes.json();
        expect(genOffBody.error.code).toBe("forbidden");
        expect(genOffBody.error.message).toBe(MODULE_DISABLED_MESSAGE);

        const todayOffRes = await dispatchQuery("briefings.today", { institution: inst.slug, input: {} }, principalAuth);
        expect(todayOffRes.status).toBe(403);
        const todayOffBody = await todayOffRes.json();
        expect(todayOffBody.error.code).toBe("forbidden");
        expect(todayOffBody.error.message).toBe(MODULE_DISABLED_MESSAGE);

        const routeOffRes = await withBearerToken((await tokenFor(inst, "principal")), () =>
          briefingRoutePost(
            jsonRequest(
              "http://localhost/api/ai/dashboard-briefing",
              { institutionSlug: inst.slug, openEnquiries: 0, enrolledCount: 0, collections: null },
              {},
            ),
          ),
        );
        expect(routeOffRes.status).toBe(502);
        const routeOffBody = await routeOffRes.json();
        expect(routeOffBody.error.code).toBe("ai_unavailable");

        // --- re-enable ---
        const enableRes = await dispatchAction(
          "core.module.set",
          { institution: inst.slug, input: { key: "ai_briefings", enabled: true } },
          principalAuth,
        );
        expect(enableRes.status).toBe(200);

        // --- admin builds a draft, timetable.suggest -> 200 non-empty, slot count unchanged ---
        const yearId = await createAcademicYear(inst.institutionId);
        const gradeId = await createGrade(inst.institutionId, { code: "VI" });
        const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
        const [teacherMembership] = await sql`
          select staff_id from public.memberships where institution_id = ${inst.institutionId}::uuid and role = 'teacher'
        `;
        const teacherStaffId = teacherMembership.staff_id as string;
        const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
        await createSubjectAssignment(inst.institutionId, sectionId, subjectId, teacherStaffId);

        const periodRes = await dispatchAction(
          "timetable.period.upsert",
          { institution: inst.slug, input: { seq: 1, name: "Period 1", startsAt: "09:00", endsAt: "09:40" } },
          adminAuth,
        );
        expect(periodRes.status).toBe(200);

        const versionRes = await dispatchAction(
          "timetable.version.create",
          { institution: inst.slug, input: { academicYearId: yearId, name: "Draft v1" } },
          adminAuth,
        );
        expect(versionRes.status).toBe(200);
        const versionBody = await versionRes.json();
        const versionId = versionBody.data.id as string;

        async function slotCount(): Promise<number> {
          const rows = await sql`select 1 from public.timetable_slots where version_id = ${versionId}::uuid`;
          return rows.length;
        }

        const before = await slotCount();
        const suggestRes = await dispatchQuery("timetable.suggest", { institution: inst.slug, input: { versionId } }, adminAuth);
        expect(suggestRes.status).toBe(200);
        const suggestBody = await suggestRes.json();
        expect(suggestBody.ok).toBe(true);
        expect(suggestBody.data.suggestions.length).toBeGreaterThan(0);
        expect(await slotCount()).toBe(before);

        const saveRes = await dispatchAction(
          "timetable.saveDraft",
          { institution: inst.slug, input: { versionId, slots: suggestBody.data.suggestions.map((s: { slot: unknown }) => s.slot) } },
          adminAuth,
        );
        expect(saveRes.status).toBe(200);
        expect(await slotCount()).toBe(before + suggestBody.data.suggestions.length);

        // suggest again -> the just-filled cells are no longer proposed
        const suggestAgainRes = await dispatchQuery(
          "timetable.suggest",
          { institution: inst.slug, input: { versionId } },
          adminAuth,
        );
        const suggestAgainBody = await suggestAgainRes.json();
        expect(suggestAgainBody.data.unfilled).toBe(0);

        // teacher -> forbidden
        const teacherSuggestRes = await dispatchQuery(
          "timetable.suggest",
          { institution: inst.slug, input: { versionId } },
          teacherAuth,
        );
        expect(teacherSuggestRes.status).toBe(403);
      } finally {
        await inst.cleanup();
      }
    },
  );

  it("seeded demo tenant, read-only: buildBriefing as the demo principal returns >=3 sources and >=3 items", async () => {
    const { ctx, client } = await buildDemoContext("principal", "principal");
    const { data: session, error } = await client.auth.getSession();
    if (error || !session.session) throw error ?? new Error("no demo principal session");

    const result = await withBearerToken(session.session.access_token, () => buildBriefing(ctx));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.sources.length).toBeGreaterThanOrEqual(3);
    expect(result.data.items.length).toBeGreaterThanOrEqual(3);
    // Printed for the completion report (rulings "print the item texts").
    console.log("Demo principal briefing items:", result.data.items.map((item) => item.text));
  });
});
