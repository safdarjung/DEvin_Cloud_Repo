import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (tests/db/dashboard-office.test.ts precedent): the composers'
// sub-reads call `createClient()` themselves, routed to a signed-in demo client.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { getQueryMeta } from "@/lib/actions/define-query";
import "@/modules/core/query-defs";
import { permissionsFor } from "@/lib/auth/permissions";
import { principalDashboard, operationsDashboard } from "@/modules/core/dashboard-leader.queries";
import { pendingApprovals } from "@/modules/core/approvals.queries";
import { setActingClient } from "../helpers/server-client-mock";
import { buildDemoContext, closeDemoHelper, withModules } from "../helpers/demo-context";

// M16-T7 — reads the seeded `st-josephs-demo` tenant, never writes it.
afterAll(async () => {
  await closeDemoHelper();
});

describe("M16-T7 dashboard.principal (seeded demo tenant, real RLS)", () => {
  it("principal: every DashboardDTO key, attendanceTrend array, approvals == pendingApprovals, staffToday numeric", async () => {
    const { ctx, client } = await buildDemoContext("principal", "principal");
    setActingClient(client);
    try {
      const result = await principalDashboard(ctx);
      for (const key of ["attendanceToday", "sectionsAtRisk", "funnel", "gradeDistribution", "collections", "recentActivity"]) {
        expect(result, key).toHaveProperty(key);
      }
      expect(Array.isArray(result.attendanceTrend)).toBe(true);
      expect(result.approvals).toEqual(await pendingApprovals(ctx));
      expect(result.staffToday).not.toBeNull();
      expect(typeof result.staffToday!.present).toBe("number");
      expect(typeof result.staffToday!.onLeave).toBe("number");
      expect(typeof result.staffToday!.absent).toBe("number");
    } finally {
      setActingClient(null);
    }
  }, 20_000);

  it("accountant (dashboard.view + staff.read, no attendance.read) -> attendanceTrend null", async () => {
    const { ctx, client } = await buildDemoContext("accountant", "accountant");
    setActingClient(client);
    try {
      const result = await principalDashboard(ctx);
      expect(result.attendanceTrend).toBeNull();
    } finally {
      setActingClient(null);
    }
  }, 20_000);

  it("withModules({staff_attendance:false}) -> staffToday null", async () => {
    const { ctx, client } = await buildDemoContext("principal", "principal");
    setActingClient(client);
    try {
      const result = await principalDashboard(withModules(ctx, { staff_attendance: false }));
      expect(result.staffToday).toBeNull();
    } finally {
      setActingClient(null);
    }
  }, 20_000);
});

describe("M16-T7 dashboard.operations (seeded demo tenant, real RLS)", () => {
  it("admin: four non-null fields; coverNeeded rows uncovered only; <=5 maintenance, <=5 events", async () => {
    const { ctx, client } = await buildDemoContext("admin", "admin");
    setActingClient(client);
    try {
      const result = await operationsDashboard(ctx);
      expect(result.staffToday).not.toBeNull();
      expect(result.coverNeeded).not.toBeNull();
      expect(result.openMaintenance).not.toBeNull();
      expect(result.upcomingEvents).not.toBeNull();
      for (const row of result.coverNeeded!) expect(row.substitution).toBeNull();
      expect(result.openMaintenance!.length).toBeLessThanOrEqual(5);
      expect(result.upcomingEvents!.length).toBeLessThanOrEqual(5);
    } finally {
      setActingClient(null);
    }
  }, 20_000);

  it("{facilities:false} -> openMaintenance null; {substitution:false} -> coverNeeded null", async () => {
    const { ctx, client } = await buildDemoContext("admin", "admin");
    setActingClient(client);
    try {
      const noFacilities = await operationsDashboard(withModules(ctx, { facilities: false }));
      expect(noFacilities.openMaintenance).toBeNull();
      const noSubstitution = await operationsDashboard(withModules(ctx, { substitution: false }));
      expect(noSubstitution.coverNeeded).toBeNull();
    } finally {
      setActingClient(null);
    }
  }, 20_000);
});

describe("M16-T7 query defs", () => {
  it("dashboard.principal and dashboard.operations are registered on dashboard.view, module core; teacher lacks it", () => {
    for (const name of ["dashboard.principal", "dashboard.operations"]) {
      const meta = getQueryMeta().get(name);
      expect(meta, name).toBeDefined();
      expect(meta!.permission).toBe("dashboard.view");
      expect(meta!.module).toBe("core");
    }
    expect(permissionsFor("teacher").includes("dashboard.view")).toBe(false);
  });
});
