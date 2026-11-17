import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph
// gets them; every other db test file keeps the real modules.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import {
  addEnquiryNote,
  assignEnquiry,
  convertEnquiryToApplication,
  decideApplication,
  startApplicationReview,
  updateEnquiryStatus,
} from "@/modules/admissions/actions";
import { getAdmissionsFunnelCounts, getApplication, getEnquiry, listApplicationDecisions } from "@/modules/admissions/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createApplication, createEnquiry, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

function serviceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}
  `;
  return row.staff_id as string;
}

// institutions.settings defaults to '{}' (0002) — createApplication relies
// on app.next_sequence's 'application_no' numbering pattern, same setup as
// admissions-schema.test.ts/enrolment.test.ts.
async function setNumberingSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('numbering', jsonb_build_object('application_no', 'APP/{YYYY}/{SEQ:5}'))
    where id = ${institutionId}
  `;
}

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("admissions pipeline actions (T-027) — real actions via callAs + the mocked server client", () => {
  it("updateEnquiryStatus moves forward and backward between configured stages, each with an audit row (AC1)", async () => {
    const inst = await createTestInstitution("adm-status-move");
    try {
      const enquiryId = await createEnquiry(inst.institutionId, { status: "new" });

      const forward = await callAs(inst, "admissions", updateEnquiryStatus, { enquiryId, status: "contacted" });
      expect(forward.ok).toBe(true);

      const backward = await callAs(inst, "admissions", updateEnquiryStatus, { enquiryId, status: "new" });
      expect(backward.ok).toBe(true);

      const ctx = await buildContext(inst, "admissions");
      setActingClient(inst.clientAs("admissions") as unknown as SupabaseClient<Database>);
      const row = await getEnquiry(ctx, enquiryId);
      setActingClient(null);
      expect(row?.status).toBe("new");

      const auditRows = await sql`
        select action, before, after from public.audit_events
        where entity_id = ${enquiryId}::uuid and action = 'admissions.enquiry.status'
        order by created_at asc
      `;
      expect(auditRows).toHaveLength(2);
      expect(auditRows[0].before).toEqual({ status: "new" });
      expect(auditRows[0].after).toEqual({ status: "contacted" });
    } finally {
      await inst.cleanup();
    }
  });

  it("updateEnquiryStatus rejects moving into converted directly, and rejects any move out of converted (invalid_state)", async () => {
    const inst = await createTestInstitution("adm-status-guard");
    try {
      const enquiryId = await createEnquiry(inst.institutionId, { status: "application_sent" });

      const intoConverted = await callAs(inst, "admissions", updateEnquiryStatus, { enquiryId, status: "converted" });
      expect(intoConverted.ok).toBe(false);
      if (!intoConverted.ok) expect(intoConverted.error.code).toBe("invalid_state");

      const convertedId = await createEnquiry(inst.institutionId, { status: "converted" });
      const outOfConverted = await callAs(inst, "admissions", updateEnquiryStatus, { enquiryId: convertedId, status: "closed" });
      expect(outOfConverted.ok).toBe(false);
      if (!outOfConverted.ok) expect(outOfConverted.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("addEnquiryNote appends {author, at, text}, normalizing a legacy single-object notes value into an array", async () => {
    const inst = await createTestInstitution("adm-notes");
    try {
      const enquiryId = await createEnquiry(inst.institutionId, { notes: { message: "walked in off the street" } });

      const result = await callAs(inst, "admissions", addEnquiryNote, { enquiryId, text: "Called back, interested." });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Array.isArray(result.data.notes)).toBe(true);
      expect(result.data.notes).toHaveLength(2);
      expect(result.data.notes[0]).toMatchObject({ message: "walked in off the street" });
      expect(result.data.notes[1]).toMatchObject({ text: "Called back, interested." });
      expect(typeof result.data.notes[1].author).toBe("string");
    } finally {
      await inst.cleanup();
    }
  });

  it("assignEnquiry returns not_found for a staff id from another institution; succeeds for one in-tenant", async () => {
    const instA = await createTestInstitution("adm-assign-a");
    const instB = await createTestInstitution("adm-assign-b");
    try {
      const enquiryId = await createEnquiry(instA.institutionId);
      const staffFromB = await staffIdFor(instB.institutionId, "teacher");

      const crossTenant = await callAs(instA, "admissions", assignEnquiry, { enquiryId, staffId: staffFromB });
      expect(crossTenant.ok).toBe(false);
      if (!crossTenant.ok) expect(crossTenant.error.code).toBe("not_found");

      const staffInA = await staffIdFor(instA.institutionId, "admissions");
      const ok = await callAs(instA, "admissions", assignEnquiry, { enquiryId, staffId: staffInA });
      expect(ok.ok).toBe(true);
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  // Fix round 1 (security review, HIGH): `public.staff_in_institution` was
  // a cross-tenant oracle (any authenticated caller could pass an
  // arbitrary institution id and learn whether a staff id belongs there,
  // with no membership check). The wrapper is gone entirely — confirm no
  // such RPC is callable any more, and that the enquiries_update WITH
  // CHECK itself is both the only authority (cross-tenant assigned_to
  // rejected) and still lets a same-tenant admissions assignment through.
  it("fix round 1: public.staff_in_institution no longer exists; the enquiries_update policy alone gates cross-tenant/same-tenant assigned_to", async () => {
    const instA = await createTestInstitution("adm-staff-oracle-a");
    const instB = await createTestInstitution("adm-staff-oracle-b");
    try {
      const gone = await instA
        .clientAs("admissions")
        .rpc("staff_in_institution", { p_staff_id: crypto.randomUUID(), p_institution_id: instB.institutionId });
      expect(gone.error).not.toBeNull();
      expect(gone.error?.message ?? "").toMatch(/staff_in_institution|does not exist|schema cache/i);

      const enquiryId = await createEnquiry(instA.institutionId);
      const staffFromB = await staffIdFor(instB.institutionId, "teacher");
      const crossTenant = await instA
        .clientAs("admissions")
        .from("enquiries")
        .update({ assigned_to: staffFromB })
        .eq("id", enquiryId);
      expect(crossTenant.error).not.toBeNull();

      const staffInA = await staffIdFor(instA.institutionId, "admissions");
      const sameTenant = await instA
        .clientAs("admissions")
        .from("enquiries")
        .update({ assigned_to: staffInA })
        .eq("id", enquiryId)
        .select("assigned_to")
        .single();
      expect(sameTenant.error).toBeNull();
      expect(sameTenant.data?.assigned_to).toBe(staffInA);
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("converts an enquiry into an application (APP/{year}/...), sets the enquiry converted, and rejects converting twice (AC2)", async () => {
    const inst = await createTestInstitution("adm-convert");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const enquiryId = await createEnquiry(inst.institutionId, { status: "application_sent" });

      const input = {
        enquiryId,
        applicant: { firstName: "Riya", lastName: "Verma", dob: "2018-05-01", gender: "female" },
        guardian: { fullName: "Sunita Verma", phone: "9800000101", relationship: "mother" as const },
        gradeId,
        academicYearId: yearId,
      };

      const converted = await callAs(inst, "admissions", convertEnquiryToApplication, input);
      expect(converted.ok).toBe(true);
      if (!converted.ok) return;
      expect(converted.data.applicationNo).toMatch(/^APP\/\d{4}\/\d{5}$/);

      const ctx = await buildContext(inst, "admissions");
      setActingClient(inst.clientAs("admissions") as unknown as SupabaseClient<Database>);
      const enquiry = await getEnquiry(ctx, enquiryId);
      const application = await getApplication(ctx, converted.data.applicationId);
      setActingClient(null);
      expect(enquiry?.status).toBe("converted");
      expect(application?.status).toBe("submitted");

      const again = await callAs(inst, "admissions", convertEnquiryToApplication, input);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("decideApplication: offer then accept works; reject writes a decision row; admin is forbidden (admin excluded from admissions.application.decide)", async () => {
    const inst = await createTestInstitution("adm-decide");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId, { status: "under_review" });

      const adminTry = await callAs(inst, "admin", decideApplication, { applicationId, decision: "offer" });
      expect(adminTry.ok).toBe(false);
      if (!adminTry.ok) expect(adminTry.error.code).toBe("forbidden");

      const offer = await callAs(inst, "admissions", decideApplication, { applicationId, decision: "offer", note: "Strong interview" });
      expect(offer.ok).toBe(true);
      if (offer.ok) expect(offer.data.status).toBe("offered");

      const accept = await callAs(inst, "admissions", decideApplication, { applicationId, decision: "accept" });
      expect(accept.ok).toBe(true);
      if (accept.ok) expect(accept.data.status).toBe("accepted");

      const ctx = await buildContext(inst, "admissions");
      setActingClient(inst.clientAs("admissions") as unknown as SupabaseClient<Database>);
      const decisions = await listApplicationDecisions(ctx, applicationId);
      setActingClient(null);
      expect(decisions.map((d) => d.decision)).toEqual(["offer", "accept"]);

      const applicationB = await createApplication(inst.institutionId, gradeId, yearId, { status: "under_review" });
      const reject = await callAs(inst, "principal", decideApplication, { applicationId: applicationB, decision: "reject", note: "Capacity full" });
      expect(reject.ok).toBe(true);
      const [decisionRow] = await sql`select decision, note from public.application_decisions where application_id = ${applicationB}::uuid`;
      expect(decisionRow.decision).toBe("reject");
      expect(decisionRow.note).toBe("Capacity full");
    } finally {
      await inst.cleanup();
    }
  });

  it("decideApplication rejects submitted -> accepted directly (AC3 state guard)", async () => {
    const inst = await createTestInstitution("adm-decide-guard");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId, { status: "submitted" });

      const result = await callAs(inst, "admissions", decideApplication, { applicationId, decision: "accept" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("startApplicationReview moves submitted -> under_review so offer works; a second start is invalid_state; admin is forbidden", async () => {
    const inst = await createTestInstitution("adm-start-review");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId, { status: "submitted" });

      const adminTry = await callAs(inst, "admin", startApplicationReview, { applicationId });
      expect(adminTry.ok).toBe(false);
      if (!adminTry.ok) expect(adminTry.error.code).toBe("forbidden");

      const started = await callAs(inst, "admissions", startApplicationReview, { applicationId });
      expect(started.ok).toBe(true);
      const [row] = await sql`select status from public.applications where id = ${applicationId}::uuid`;
      expect(row.status).toBe("under_review");

      const again = await callAs(inst, "admissions", startApplicationReview, { applicationId });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("invalid_state");

      const offer = await callAs(inst, "admissions", decideApplication, { applicationId, decision: "offer" });
      expect(offer.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("getAdmissionsFunnelCounts matches direct SQL counts per enquiry stage and application status (AC4)", async () => {
    const inst = await createTestInstitution("adm-funnel");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      await createEnquiry(inst.institutionId, { status: "new" });
      await createEnquiry(inst.institutionId, { status: "new" });
      await createEnquiry(inst.institutionId, { status: "contacted" });
      await createApplication(inst.institutionId, gradeId, yearId, { status: "under_review" });
      await createApplication(inst.institutionId, gradeId, yearId, { status: "offered" });

      const ctx = await buildContext(inst, "admissions");
      setActingClient(inst.clientAs("admissions") as unknown as SupabaseClient<Database>);
      const counts = await getAdmissionsFunnelCounts(ctx);
      setActingClient(null);

      expect(counts.enquiryStages.new).toBe(2);
      expect(counts.enquiryStages.contacted).toBe(1);
      expect(counts.applicationStatuses.under_review).toBe(1);
      expect(counts.applicationStatuses.offered).toBe(1);

      const [{ count: sqlEnquiryNew }] = await sql`select count(*)::int as count from public.enquiries where institution_id = ${inst.institutionId} and status = 'new'`;
      expect(counts.enquiryStages.new).toBe(sqlEnquiryNew);
    } finally {
      await inst.cleanup();
    }
  });

  // Guard bypass checks (packet item 3) — a direct UPDATE into a decided
  // state is rejected for an authenticated role, and explicitly allowed for
  // service_role / session_user='postgres' (the seed path), same shape as
  // 0014's attendance guard tests and exams-schema.test.ts's fix-round-2 test.
  it("guard_application_decision: direct UPDATE into offered is rejected for authenticated, explicitly bypassed for service_role", async () => {
    const inst = await createTestInstitution("adm-decision-guard-bypass");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const applicationId = await createApplication(inst.institutionId, gradeId, yearId, { status: "under_review" });

      const direct = await inst.clientAs("admissions").from("applications").update({ status: "offered" }).eq("id", applicationId);
      expect(direct.error).not.toBeNull();

      const serviceClient = serviceRoleClient();
      const bypassed = await serviceClient.from("applications").update({ status: "offered" }).eq("id", applicationId).select("status").single();
      expect(bypassed.error).toBeNull();
      expect(bypassed.data?.status).toBe("offered");
    } finally {
      await inst.cleanup();
    }
  });

  it("guard_enquiry_mutation: direct UPDATE of status to converted or of notes is rejected for authenticated, bypassed for service_role", async () => {
    const inst = await createTestInstitution("adm-enquiry-guard-bypass");
    try {
      const enquiryId = await createEnquiry(inst.institutionId, { status: "application_sent" });

      const directStatus = await inst.clientAs("admissions").from("enquiries").update({ status: "converted" }).eq("id", enquiryId);
      expect(directStatus.error).not.toBeNull();

      const directNotes = await inst.clientAs("admissions").from("enquiries").update({ notes: [{ text: "sneaky" }] }).eq("id", enquiryId);
      expect(directNotes.error).not.toBeNull();

      const serviceClient = serviceRoleClient();
      const bypassed = await serviceClient.from("enquiries").update({ status: "converted" }).eq("id", enquiryId).select("status").single();
      expect(bypassed.error).toBeNull();
      expect(bypassed.data?.status).toBe("converted");
    } finally {
      await inst.cleanup();
    }
  });
});
