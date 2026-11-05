import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { saveScheduledReport, setScheduledReportStatus } from "@/modules/reports/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// M15-T10 — report.schedule.save / report.schedule.setStatus. Column names
// exactly as 0077: scheduled_reports.{name, source, params, cron,
// recipient_roles, status, next_run_at, created_by}.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function setModule(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', ${key}], ${enabled}::text::jsonb)
    where id = ${institutionId}::uuid
  `;
}

function nextTwentyHundredIst(after: Date): Date {
  // 20:00 IST = 14:30 UTC same calendar date (no DST in India); the IST
  // calendar date of `after` can differ from its UTC calendar date, so the
  // date must come from an IST-zoned format, not getUTC*.
  const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(after);
  const [y, m, d] = istDate.split("-").map(Number);
  let candidate = new Date(Date.UTC(y, m - 1, d, 14, 30, 0));
  if (candidate <= after) candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  return candidate;
}

describe("report schedule actions (M15-T10)", () => {
  it("principal saves a nightly attendance report; same name conflicts; invalid recipient/cron are validation_failed", async () => {
    const inst = await createTestInstitution("report-actions-save");
    try {
      const before = new Date();
      const saved = await callAs(inst, "principal", saveScheduledReport, {
        name: "Nightly attendance",
        source: "attendance.daily",
        cron: "0 20 * * *",
        recipientRoles: ["principal"],
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      expect(saved.data.nextRunAt).not.toBeNull();
      const expected = nextTwentyHundredIst(before);
      expect(new Date(saved.data.nextRunAt as string).getTime()).toBe(expected.getTime());

      // Same name again -> conflict with fieldErrors.name.
      const dup = await callAs(inst, "principal", saveScheduledReport, {
        name: "Nightly attendance",
        source: "attendance.daily",
        cron: "0 20 * * *",
        recipientRoles: ["principal"],
      });
      expect(dup.ok).toBe(false);
      if (dup.ok) return;
      expect(dup.error.code).toBe("conflict");
      expect(dup.error.fieldErrors?.name).toBeDefined();

      // Teacher is not an allowed recipient for attendance.daily.
      const badRole = await callAs(inst, "principal", saveScheduledReport, {
        name: "Bad role report",
        source: "attendance.daily",
        cron: "0 20 * * *",
        recipientRoles: ["teacher"],
      });
      expect(badRole.ok).toBe(false);
      if (badRole.ok) return;
      expect(badRole.error.code).toBe("validation_failed");

      // Invalid cron grammar (steps not supported).
      const badCron = await callAs(inst, "principal", saveScheduledReport, {
        name: "Bad cron report",
        source: "attendance.daily",
        cron: "*/5 * * * *",
        recipientRoles: ["principal"],
      });
      expect(badCron.ok).toBe(false);
      if (badCron.ok) return;
      expect(badCron.error.code).toBe("validation_failed");
      expect(badCron.error.fieldErrors?.cron).toBeDefined();

      // Audit metadata holds ids + source only.
      const auditRows = await sql`
        select metadata from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'report.schedule.saved'
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].metadata).toEqual({ id: saved.data.id, source: "attendance.daily" });
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant lacks report.schedule; module off is forbidden; setStatus toggles next_run_at", async () => {
    const inst = await createTestInstitution("report-actions-status");
    try {
      const forbidden = await callAs(inst, "accountant", saveScheduledReport, {
        name: "Defaulters",
        source: "finance.defaulters",
        cron: "0 18 * * 1-6",
        recipientRoles: ["accountant"],
      });
      expect(forbidden.ok).toBe(false);
      if (forbidden.ok) return;
      expect(forbidden.error.code).toBe("forbidden");

      // Module off for this institution -> forbidden before validation runs.
      await setModule(inst.institutionId, "scheduled_reports", false);
      const moduleOff = await callAs(inst, "principal", saveScheduledReport, {
        name: "Defaulters",
        source: "finance.defaulters",
        cron: "0 18 * * 1-6",
        recipientRoles: ["accountant", "principal"],
      });
      expect(moduleOff.ok).toBe(false);
      if (moduleOff.ok) return;
      expect(moduleOff.error.code).toBe("forbidden");
      await setModule(inst.institutionId, "scheduled_reports", true);

      const saved = await callAs(inst, "principal", saveScheduledReport, {
        name: "Defaulters",
        source: "finance.defaulters",
        cron: "0 18 * * 1-6",
        recipientRoles: ["accountant", "principal"],
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      expect(saved.data.status).toBe("active");
      expect(saved.data.nextRunAt).not.toBeNull();

      const paused = await callAs(inst, "principal", setScheduledReportStatus, {
        id: saved.data.id,
        status: "paused",
      });
      expect(paused.ok).toBe(true);
      if (!paused.ok) return;
      expect(paused.data.status).toBe("paused");
      expect(paused.data.nextRunAt).toBeNull();

      const resumed = await callAs(inst, "principal", setScheduledReportStatus, {
        id: saved.data.id,
        status: "active",
      });
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(resumed.data.status).toBe("active");
      expect(resumed.data.nextRunAt).not.toBeNull();

      const statusAudit = await sql`
        select metadata from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'report.schedule.status_set'
        order by created_at
      `;
      expect(statusAudit).toHaveLength(2);
      expect(statusAudit[0].metadata).toEqual({ id: saved.data.id, status: "paused" });
      expect(statusAudit[1].metadata).toEqual({ id: saved.data.id, status: "active" });
    } finally {
      await inst.cleanup();
    }
  });

  it("updating by another institution's schedule id is not_found", async () => {
    await withTwoInstitutions(async (a, b) => {
      const createdInB = await callAs(b, "principal", saveScheduledReport, {
        name: "B's report",
        source: "attendance.daily",
        cron: "0 20 * * *",
        recipientRoles: ["principal"],
      });
      expect(createdInB.ok).toBe(true);
      if (!createdInB.ok) return;

      const crossInstitutionUpdate = await callAs(a, "principal", saveScheduledReport, {
        id: createdInB.data.id,
        name: "Hijacked name",
        source: "attendance.daily",
        cron: "0 20 * * *",
        recipientRoles: ["principal"],
      });
      expect(crossInstitutionUpdate.ok).toBe(false);
      if (crossInstitutionUpdate.ok) return;
      expect(crossInstitutionUpdate.error.code).toBe("not_found");
    });
  });
});
