import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { upsertAcademicYear, upsertTerm, updateInstitutionSettings } from "@/modules/core/actions";
import { createAcademicYear, closeFactoriesHelper } from "../helpers/factories";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// M03-T8 — core.academicYear.upsert / core.term.upsert /
// core.institution.updateSettings. app.validate_term_dates (0002) and the
// partial unique index academic_years_one_current_idx are the real
// invariants; these tests exercise the action wrapper around them.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("upsertAcademicYear / upsertTerm (M03-T8)", () => {
  it("admin creates a next academic year and a term inside it", async () => {
    const inst = await createTestInstitution("core-setup-year-term-ok");

    const year = await callAs(inst, "admin", upsertAcademicYear, {
      name: "2027-28",
      startsOn: "2027-04-01",
      endsOn: "2028-03-31",
    });
    expect(year.ok).toBe(true);
    if (!year.ok) return;

    const term = await callAs(inst, "admin", upsertTerm, {
      academicYearId: year.data.id,
      name: "Term 1",
      startsOn: "2027-04-01",
      endsOn: "2027-09-30",
    });
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.data.academicYearId).toBe(year.data.id);
  });

  it("a term outside its academic year is validation_failed", async () => {
    const inst = await createTestInstitution("core-setup-term-bounds");
    const yearId = await createAcademicYear(inst.institutionId, {
      name: "2027-28",
      startsOn: "2027-04-01",
      endsOn: "2028-03-31",
      isCurrent: false,
    });

    const result = await callAs(inst, "admin", upsertTerm, {
      academicYearId: yearId,
      name: "Term 1",
      startsOn: "2026-01-01",
      endsOn: "2026-02-01",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });

  it("switching the current year leaves exactly one current", async () => {
    const inst = await createTestInstitution("core-setup-year-current");
    const oldYearId = await createAcademicYear(inst.institutionId, {
      name: "2026-27",
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
      isCurrent: true,
    });

    const result = await callAs(inst, "admin", upsertAcademicYear, {
      name: "2027-28",
      startsOn: "2027-04-01",
      endsOn: "2028-03-31",
      isCurrent: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const currentRows = await sql`
      select id from public.academic_years where institution_id = ${inst.institutionId} and is_current
    `;
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0].id).toBe(result.data.id);
    expect(currentRows[0].id).not.toBe(oldYearId);
  });

  it("an accountant is forbidden", async () => {
    const inst = await createTestInstitution("core-setup-year-forbidden");

    const result = await callAs(inst, "accountant", upsertAcademicYear, {
      name: "2027-28",
      startsOn: "2027-04-01",
      endsOn: "2028-03-31",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });
});

describe("updateInstitutionSettings (M03-T8)", () => {
  it("round-trips a timezone update", async () => {
    const inst = await createTestInstitution("core-setup-settings-timezone");

    const result = await callAs(inst, "owner", updateInstitutionSettings, { timezone: "Asia/Dubai" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data.settings as { locale?: { timezone?: string } }).locale?.timezone).toBe("Asia/Dubai");

    const [row] = await sql`select settings from public.institutions where id = ${inst.institutionId}`;
    expect(row.settings.locale.timezone).toBe("Asia/Dubai");
  });

  it("an accountant is forbidden", async () => {
    const inst = await createTestInstitution("core-setup-settings-forbidden");

    const result = await callAs(inst, "accountant", updateInstitutionSettings, { timezone: "Asia/Dubai" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });
});
