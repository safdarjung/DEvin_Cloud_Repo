import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeFactoriesHelper, createAcademicYear, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

// service_role client — the only role granted execute on
// public.submit_public_enquiry (lead security review, HIGH). Real PostgREST
// RPC, not the raw `sql` admin connection above: that connection is a
// Postgres superuser and bypasses EXECUTE grants entirely, which would
// prove nothing about anon/authenticated/service_role access.
function serviceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

// `public.websites` lands in migration 0010 (T-023), numbered after this
// packet's 0007 on purpose (05 §4.1 backlog index) — app.submit_public_enquiry
// forward-references it the same way 0001's helpers forward-reference
// 0002-0005's tables (plpgsql resolves relation names at call time, not at
// CREATE FUNCTION time). Until 0010 is merged, the table plainly does not
// exist in this schema yet, so every call to submit_public_enquiry errors
// before it can reach the slug/is_live check. Tests that exercise the
// function are gated on this and skip (not fail) until then.
let hasWebsitesTable = false;

async function setNumberingSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'numbering', jsonb_build_object('application_no', 'APP/{YYYY}/{SEQ:5}')
    )
    where id = ${institutionId}
  `;
}

async function makeLiveWebsite(institutionId: string): Promise<void> {
  await sql`insert into public.websites (institution_id, is_live) values (${institutionId}, true)`;
}

beforeAll(async () => {
  const [row] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'websites'
    ) as exists
  `;
  hasWebsitesTable = row.exists;
});

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("admissions migration (0007) schema + RLS", () => {
  it("application_no is allocated as APP/{YYYY}/{SEQ:5} when omitted", async () => {
    const inst = await createTestInstitution("adm-numbering");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);

      const [app1] = await sql`
        insert into public.applications (institution_id, applicant, guardian, grade_applied_id, academic_year_id)
        values (${inst.institutionId}, '{"firstName":"A"}'::jsonb, '{"fullName":"G"}'::jsonb, ${gradeId}, ${yearId})
        returning application_no
      `;
      const [app2] = await sql`
        insert into public.applications (institution_id, applicant, guardian, grade_applied_id, academic_year_id)
        values (${inst.institutionId}, '{"firstName":"B"}'::jsonb, '{"fullName":"G"}'::jsonb, ${gradeId}, ${yearId})
        returning application_no
      `;

      const year = new Date().getFullYear();
      expect(app1.application_no).toBe(`APP/${year}/00001`);
      expect(app2.application_no).toBe(`APP/${year}/00002`);
    } finally {
      await inst.cleanup();
    }
  });

  it("application_decisions is append-only — insert succeeds, UPDATE/DELETE raise", async () => {
    const inst = await createTestInstitution("adm-decisions-append-only");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [application] = await sql`
        insert into public.applications (institution_id, applicant, guardian, grade_applied_id, academic_year_id)
        values (${inst.institutionId}, '{"firstName":"A"}'::jsonb, '{"fullName":"G"}'::jsonb, ${gradeId}, ${yearId})
        returning id
      `;

      const insertDecision = await inst
        .clientAs("admissions")
        .from("application_decisions")
        .insert({ institution_id: inst.institutionId, application_id: application.id, decision: "offer" })
        .select("id")
        .single();
      expect(insertDecision.error).toBeNull();

      await expect(
        sql`update public.application_decisions set note = 'x' where id = ${insertDecision.data!.id}`,
      ).rejects.toThrow(/invalid_state/);
      await expect(
        sql`delete from public.application_decisions where id = ${insertDecision.data!.id}`,
      ).rejects.toThrow(/invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  // 07 §2.2: admissions.enquiry.read/write and admissions.enrol grant
  // own/principal/admin/admissions only — accountant/exam_controller/teacher
  // are excluded (narrower than app.staff_roles()).
  it("teacher, accountant and exam_controller cannot read enquiries or applications", async () => {
    const inst = await createTestInstitution("adm-role-scope");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      await sql`
        insert into public.enquiries (institution_id, child_name, guardian_name, phone)
        values (${inst.institutionId}, 'Child', 'Guardian', '9800000001')
      `;
      await sql`
        insert into public.applications (institution_id, applicant, guardian, grade_applied_id, academic_year_id)
        values (${inst.institutionId}, '{}'::jsonb, '{}'::jsonb, ${gradeId}, ${yearId})
      `;

      for (const role of ["teacher", "accountant", "exam_controller"] as const) {
        const enquiries = await inst.clientAs(role).from("enquiries").select("id");
        expect(enquiries.error).toBeNull();
        expect(enquiries.data).toHaveLength(0);

        const applications = await inst.clientAs(role).from("applications").select("id");
        expect(applications.error).toBeNull();
        expect(applications.data).toHaveLength(0);
      }

      for (const role of ["owner", "principal", "admin", "admissions"] as const) {
        const enquiries = await inst.clientAs(role).from("enquiries").select("id");
        expect(enquiries.data).toHaveLength(1);
      }
    } finally {
      await inst.cleanup();
    }
  });

  // 07 §2.2 `admissions.application.decide` deviation (own/principal/
  // admissions; admin excluded) — see tests/security/rls-expectations.ts.
  it("admin cannot insert application_decisions; owner/principal/admissions can", async () => {
    const inst = await createTestInstitution("adm-decide-scope");
    try {
      await setNumberingSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [application] = await sql`
        insert into public.applications (institution_id, applicant, guardian, grade_applied_id, academic_year_id)
        values (${inst.institutionId}, '{}'::jsonb, '{}'::jsonb, ${gradeId}, ${yearId})
        returning id
      `;

      const asAdmin = await inst
        .clientAs("admin")
        .from("application_decisions")
        .insert({ institution_id: inst.institutionId, application_id: application.id, decision: "offer" });
      expect(asAdmin.error).not.toBeNull();

      for (const role of ["owner", "principal", "admissions"] as const) {
        const result = await inst
          .clientAs(role)
          .from("application_decisions")
          .insert({ institution_id: inst.institutionId, application_id: application.id, decision: "offer" });
        expect(result.error).toBeNull();
      }
    } finally {
      await inst.cleanup();
    }
  });

  // CRITICAL-shape check (05 §5 "bind every write to scope"): an
  // admissions-role caller cannot insert an application whose grade or
  // academic year belongs to another institution.
  it("cross-tenant grade_applied_id/academic_year_id on applications insert is rejected", async () => {
    const instA = await createTestInstitution("adm-scope-a");
    const instB = await createTestInstitution("adm-scope-b");
    try {
      await setNumberingSettings(instA.institutionId);
      const yearB = await createAcademicYear(instB.institutionId);
      const gradeB = await createGrade(instB.institutionId);
      const yearA = await createAcademicYear(instA.institutionId);
      const gradeA = await createGrade(instA.institutionId);

      const crossGrade = await instA
        .clientAs("admissions")
        .from("applications")
        .insert({
          institution_id: instA.institutionId,
          applicant: {},
          guardian: {},
          grade_applied_id: gradeB,
          academic_year_id: yearA,
        });
      expect(crossGrade.error).not.toBeNull();

      const crossYear = await instA
        .clientAs("admissions")
        .from("applications")
        .insert({
          institution_id: instA.institutionId,
          applicant: {},
          guardian: {},
          grade_applied_id: gradeA,
          academic_year_id: yearB,
        });
      expect(crossYear.error).not.toBeNull();
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  // HIGH fix (lead security review): a direct PostgREST RPC call bypasses
  // T-024's honeypot and lets the caller pick a fresh ip_hash per request,
  // defeating the T12 rate limit — so neither anon nor authenticated may
  // call public.submit_public_enquiry at all. Runs unconditionally: the
  // EXECUTE-privilege check happens before the function body runs, so it
  // never touches public.websites (unlike the full-flow test below).
  it("HIGH fix: only service_role may execute public.submit_public_enquiry", async () => {
    const inst = await createTestInstitution("adm-enquiry-grants");
    try {
      const anonCall = await inst
        .clientAsAnon()
        .rpc("submit_public_enquiry", { p_slug: inst.slug, p_payload: {}, p_ip_hash: "probe" });
      expect(anonCall.error).not.toBeNull();

      const authCall = await inst
        .clientAs("admissions")
        .rpc("submit_public_enquiry", { p_slug: inst.slug, p_payload: {}, p_ip_hash: "probe" });
      expect(authCall.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it.skipIf(!hasWebsitesTable)(
    "C-81/C-82/not_found: app.submit_public_enquiry rate-limits, dedupes and gates on a live website",
    async () => {
      const inst = await createTestInstitution("adm-public-enquiry");
      const admin = serviceRoleClient();
      try {
        await makeLiveWebsite(inst.institutionId);

        const unknownSlug = await admin.rpc("submit_public_enquiry", {
          p_slug: "no-such-slug",
          p_payload: {},
          p_ip_hash: "ip-x",
        });
        expect(unknownSlug.error?.message).toMatch(/not_found/);

        const basePayload = (phone: string) => ({
          childName: "Riya Verma",
          guardianName: "Sunita Verma",
          phone,
        });

        for (let i = 0; i < 5; i += 1) {
          const phone = `98000000${10 + i}`;
          const { data, error } = await admin.rpc("submit_public_enquiry", {
            p_slug: inst.slug,
            p_payload: basePayload(phone),
            p_ip_hash: "rate-ip",
          });
          expect(error).toBeNull();
          expect(data.duplicate).toBe(false);
        }

        const sixth = await admin.rpc("submit_public_enquiry", {
          p_slug: inst.slug,
          p_payload: basePayload("9800000099"),
          p_ip_hash: "rate-ip",
        });
        expect(sixth.error?.message).toMatch(/rate_limited/);

        const first = await admin.rpc("submit_public_enquiry", {
          p_slug: inst.slug,
          p_payload: basePayload("9811111111"),
          p_ip_hash: "dedupe-ip",
        });
        const second = await admin.rpc("submit_public_enquiry", {
          p_slug: inst.slug,
          p_payload: basePayload("9811111111"),
          p_ip_hash: "dedupe-ip-2",
        });
        expect(first.data.duplicate).toBe(false);
        expect(second.data.duplicate).toBe(true);
        expect(second.data.enquiry_id).toBe(first.data.enquiry_id);

        const oversizedMessage = await admin.rpc("submit_public_enquiry", {
          p_slug: inst.slug,
          p_payload: { ...basePayload("9822222222"), message: "x".repeat(2001) },
          p_ip_hash: "message-ip",
        });
        expect(oversizedMessage.error?.message).toMatch(/validation_failed/);

        const countRows = await sql`
          select count(*) from public.enquiries
          where institution_id = ${inst.institutionId} and phone = '9811111111'
        `;
        expect(Number(countRows[0].count)).toBe(1);

        const anonSelect = await inst.clientAsAnon().from("enquiries").select("id");
        expect(anonSelect.data).toHaveLength(0);
      } finally {
        await inst.cleanup();
      }
    },
  );
});
