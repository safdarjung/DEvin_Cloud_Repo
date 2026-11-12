import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { listAchievements } from "@/modules/achievements/queries";
import { listAlumni } from "@/modules/alumni/queries";
import { listIncidents } from "@/modules/behaviour/queries";
import { listCertificates } from "@/modules/certificates/queries";
import { listQuestions } from "@/modules/question-bank/queries";
import { QuestionListSchema } from "@/modules/question-bank/schemas";
import { CertificateListSchema } from "@/modules/certificates/schemas";
import { AchievementListSchema } from "@/modules/achievements/schemas";
import { AlumniListSchema } from "@/modules/alumni/schemas";
import { buildContext, closeActionsHelper } from "../helpers/actions";
import { setActingClient } from "../helpers/server-client-mock";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// Curveballs: list queries on an empty school, out-of-range pages, hostile search text, schema paging bounds.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("list queries on empty data", () => {
  it("achievements, behaviour, alumni, questions, certificates return empty pages, not errors", async () => {
    const inst = await createTestInstitution("cb-q-empty");
    try {
      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as never);
      expect(await listAchievements(ctx)).toMatchObject({ rows: [], total: 0 });
      expect(await listIncidents(ctx)).toMatchObject({ rows: [], total: 0 });
      expect(await listAlumni(ctx)).toMatchObject({ rows: [], total: 0 });
      const q = await listQuestions(ctx, QuestionListSchema.parse({}));
      expect(q.items).toEqual([]);
      expect(await listCertificates(ctx, CertificateListSchema.parse({}) as never)).toEqual([]);
    } finally { setActingClient(null); await inst.cleanup(); }
  }, 60_000);

  it("a section with no students yields an empty page for achievements/behaviour filters", async () => {
    const inst = await createTestInstitution("cb-q-sec");
    try {
      const y = await createAcademicYear(inst.institutionId);
      const g = await createGrade(inst.institutionId);
      const sec = await createClassSection(inst.institutionId, g, y, { name: "A" });
      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as never);
      expect(await listAchievements(ctx, { sectionId: sec })).toMatchObject({ rows: [], total: 0 });
      expect(await listIncidents(ctx, { sectionId: sec })).toMatchObject({ rows: [], total: 0 });
    } finally { setActingClient(null); await inst.cleanup(); }
  }, 60_000);

  it("page 0/negative clamps to 1 and returns an empty page on an empty school", async () => {
    const inst = await createTestInstitution("cb-q-page");
    try {
      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as never);
      for (const page of [0, -5]) {
        const a = await listAchievements(ctx, { page });
        expect(a.rows).toEqual([]);
        expect(a.page).toBe(1);
        expect((await listAlumni(ctx, { page })).rows).toEqual([]);
        expect((await listIncidents(ctx, { page })).rows).toEqual([]);
      }
    } finally { setActingClient(null); await inst.cleanup(); }
  }, 60_000);

  for (const [name, call] of [
    ["achievements", (c: never) => listAchievements(c, { page: 1_000_000 })],
    ["alumni", (c: never) => listAlumni(c, { page: 1_000_000 })],
    ["behaviour", (c: never) => listIncidents(c, { page: 1_000_000 })],
    ["question bank", (c: never) => listQuestions(c, QuestionListSchema.parse({ page: 1_000_000 }))],
  ] as const) {
    it(`${name} list with a page far past the data returns an empty page instead of throwing`, async () => {
      const inst = await createTestInstitution(`cb-q-far-${name.slice(0, 4)}`);
      try {
        const ctx = await buildContext(inst, "admin");
        setActingClient(inst.clientAs("admin") as never);
        await expect(call(ctx as never)).resolves.toBeDefined();
      } finally { setActingClient(null); await inst.cleanup(); }
    }, 60_000);
  }

  it("alumni search survives hostile text (%, commas, parentheses, quotes, filter syntax)", async () => {
    const inst = await createTestInstitution("cb-q-inj");
    try {
      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as never);
      for (const q of ["%", "_", "a,b", "x),id.neq.0,(y", `"quoted"`, "first_name.eq.Test", "\\", "😀"]) {
        const r = await listAlumni(ctx, { q });
        expect(r.rows, q).toEqual([]);
      }
    } finally { setActingClient(null); await inst.cleanup(); }
  }, 60_000);
});

describe("paging schema bounds", () => {
  it("question list: pageSize 0/101 and page 0 rejected; defaults 1/50", () => {
    expect(QuestionListSchema.parse({})).toMatchObject({ page: 1, pageSize: 50 });
    for (const bad of [{ pageSize: 0 }, { pageSize: 101 }, { page: 0 }, { page: 1.5 }]) {
      expect(QuestionListSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(QuestionListSchema.safeParse({ pageSize: 100 }).success).toBe(true);
  });

  it("certificate list limit 0/101 rejected; achievements/alumni page 0 rejected", () => {
    expect(CertificateListSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(CertificateListSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(CertificateListSchema.safeParse({ limit: 100 }).success).toBe(true);
    expect(AchievementListSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(AlumniListSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(AlumniListSchema.safeParse({ q: "" }).success).toBe(false);
  });
});
