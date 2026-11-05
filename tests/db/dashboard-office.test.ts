import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (tests/db/dashboard-queries.test.ts precedent): the composers'
// sub-reads call `createClient()` themselves, routed to a signed-in demo client.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { getQueryMeta } from "@/lib/actions/define-query";
import "@/modules/core/query-defs";
import { getAdmissionsFunnelCounts } from "@/modules/admissions/queries";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { admissionsDashboard, financeDashboard } from "@/modules/core/dashboard-office.queries";
import { setActingClient } from "../helpers/server-client-mock";
import { buildDemoContext, closeDemoHelper, withModules } from "../helpers/demo-context";

// M16-T8 — reads the seeded `st-josephs-demo` tenant, never writes it.
afterAll(async () => {
  await closeDemoHelper();
});

describe("M16-T8 dashboard.finance (seeded demo tenant, real RLS)", () => {
  it("accountant: collections within due, overdue ≤10 sorted by outstanding desc, every dueOn before today", async () => {
    const { ctx, client } = await buildDemoContext("accountant", "accountant");
    setActingClient(client);
    try {
      const { collections, overdue } = await financeDashboard(ctx);
      expect(collections).not.toBeNull();
      expect(collections!.collectedPaise).toBeLessThanOrEqual(collections!.duePaise);
      expect(overdue).not.toBeNull();
      expect(overdue!.length).toBeLessThanOrEqual(10);
      const today = todayInInstitutionTimezone(ctx);
      for (let i = 0; i < overdue!.length; i++) {
        expect(overdue![i].dueOn).not.toBeNull();
        expect(overdue![i].dueOn! < today).toBe(true);
        if (i > 0) expect(overdue![i - 1].outstanding).toBeGreaterThanOrEqual(overdue![i].outstanding);
      }
    } finally {
      setActingClient(null);
    }
  }, 20_000);

  it("exam_controller lacks finance.read → both fields null, no sub-read", async () => {
    const { ctx, client } = await buildDemoContext("examcontroller", "exam_controller");
    setActingClient(client);
    try {
      expect(await financeDashboard(ctx)).toEqual({ collections: null, overdue: null });
    } finally {
      setActingClient(null);
    }
  }, 20_000);
});

describe("M16-T8 dashboard.admissions (seeded demo tenant, real RLS)", () => {
  it("admissions: funnel equals getAdmissionsFunnelCounts; recentEnquiries ≤5 newest first", async () => {
    const { ctx, client } = await buildDemoContext("admissions", "admissions");
    setActingClient(client);
    try {
      const { funnel, recentEnquiries } = await admissionsDashboard(ctx);
      expect(funnel).toEqual(await getAdmissionsFunnelCounts(ctx));
      expect(recentEnquiries).not.toBeNull();
      expect(recentEnquiries!.length).toBeLessThanOrEqual(5);
      expect(recentEnquiries!.length).toBeGreaterThan(0);
      for (let i = 1; i < recentEnquiries!.length; i++) {
        expect(recentEnquiries![i - 1].createdAt >= recentEnquiries![i].createdAt).toBe(true);
      }
    } finally {
      setActingClient(null);
    }
  }, 20_000);

  it("module admissions off → both null; accountant (no admissions.enquiry.read) → both null", async () => {
    const admissions = await buildDemoContext("admissions", "admissions");
    const accountant = await buildDemoContext("accountant", "accountant");
    const nulls = { funnel: null, recentEnquiries: null };
    setActingClient(admissions.client);
    try {
      expect(await admissionsDashboard(withModules(admissions.ctx, { admissions: false }))).toEqual(nulls);
    } finally {
      setActingClient(null);
    }
    setActingClient(accountant.client);
    try {
      expect(await admissionsDashboard(accountant.ctx)).toEqual(nulls);
    } finally {
      setActingClient(null);
    }
  }, 20_000);
});

describe("M16-T8 query defs", () => {
  it("dashboard.finance and dashboard.admissions are registered on dashboard.view, module core", () => {
    for (const name of ["dashboard.finance", "dashboard.admissions"]) {
      const meta = getQueryMeta().get(name);
      expect(meta, name).toBeDefined();
      expect(meta!.permission).toBe("dashboard.view");
      expect(meta!.module).toBe("core");
    }
  });
});
