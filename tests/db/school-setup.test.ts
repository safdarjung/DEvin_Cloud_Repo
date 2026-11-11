import { createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 pattern): the core.setup.* handlers run with the fixture role's real client.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import { applyTemplate, saveBranding, setProgress } from "@/modules/core/setup/actions";
import { setupStatusQuery } from "@/modules/core/setup/query-defs";
import { buildSchoolTemplate } from "@/modules/core/setup/templates";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeInviteCodesHelper, mintInviteCode } from "../helpers/invite-codes";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// F18 §H — 0127: invite-code school creation and the "Set up for me" template.
// Part 1 uses brand-new signed-in users exactly as /start does; part 2 uses
// fixture schools (createTestInstitution) for the role and tenant checks.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";
const TEMPLATE = buildSchoolTemplate({ board: "CBSE", fromGrade: "I", toGrade: "III", sectionsPerGrade: 2, yearStart: "2026-04-01" });

function adminClient() {
  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

const userIds = new Set<string>();
const institutionIds = new Set<string>();

async function newSignedInUser(label: string) {
  const email = `school-setup-${label}-${crypto.randomUUID()}@test.local`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("test user was not created");
  userIds.add(data.user.id);
  const client = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { userId: data.user.id, email, client };
}

type UserClient = Awaited<ReturnType<typeof newSignedInUser>>["client"];

async function redeem(client: UserClient, code: string, slug: string) {
  const result = await client.rpc("create_institution_with_invite", { p_code: code, p_name: "Invite Setup School", p_slug: slug });
  const id = result.data?.[0]?.institution_id;
  if (id) institutionIds.add(id);
  return result;
}

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const hashOf = (code: string) => createHash("sha256").update(code).digest("hex");
const newSlug = (label: string) => `setup-${label}-${crypto.randomUUID().slice(0, 8)}`;

afterEach(async () => {
  for (const id of institutionIds) {
    // demo_reset clears every tenant table (audit included) but only for demo schools.
    await sql`update public.institutions set is_demo = true where id = ${id}`;
    await sql`select app.demo_reset(${id}::uuid)`;
    await sql`delete from public.institutions where id = ${id}`;
  }
  institutionIds.clear();
  for (const id of userIds) await adminClient().auth.admin.deleteUser(id);
  userIds.clear();
});

afterAll(async () => {
  await sql.end();
  await closeInviteCodesHelper();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("create_institution_with_invite (0127)", () => {
  it("a valid code creates the school, makes the caller its active owner and records one redemption", async () => {
    const { userId, client } = await newSignedInUser("ok");
    const code = await mintInviteCode();
    const slug = newSlug("ok");

    const { data, error } = await redeem(client, code, slug);
    expect(error).toBeNull();
    expect(data).toEqual([{ institution_id: expect.any(String), slug }]);
    const institutionId = data![0].institution_id;

    const [membership] = await sql`select role, status from public.memberships where institution_id = ${institutionId} and user_id = ${userId}`;
    expect(membership).toMatchObject({ role: "owner", status: "active" });
    const [row] = await sql`select used_count, id from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(row.used_count).toBe(1);
    const redemptions = await sql`select user_id, created_institution_id from public.platform_invite_redemptions where invite_code_id = ${row.id}`;
    expect(redemptions).toEqual([{ user_id: userId, created_institution_id: institutionId }]);
  });

  it("wrong, malformed, expired, revoked and used-up codes give one identical error and consume nothing", async () => {
    const { client } = await newSignedInUser("bad");
    const slug = newSlug("bad");
    const expired = await mintInviteCode({ expiresAt: new Date(Date.now() - 60_000) });
    const revoked = await mintInviteCode({ revoked: true });
    const usedUp = await mintInviteCode({ maxUses: 2, usedCount: 2 });

    const errors = [];
    for (const code of ["NOT-A-REAL-CODE", "x".repeat(300), expired, revoked, usedUp]) {
      const { data, error } = await redeem(client, code, slug);
      expect(data).toBeNull();
      errors.push(error);
    }
    expect(errors[0]).toMatchObject({ message: "code:forbidden", details: "invite code is not valid" });
    for (const error of errors) expect(error).toEqual(errors[0]);

    const codes = await sql`
      select used_count, max_uses from public.platform_invite_codes
      where code_hash in ${sql([expired, revoked, usedUp].map(hashOf))} order by max_uses
    `;
    expect(codes.map((c) => c.used_count)).toEqual([0, 0, 2]);
    expect(await sql`select 1 from public.institutions where slug = ${slug}`).toHaveLength(0);
  });

  it("a code bound to an email redeems only for the caller whose own email it is; anyone else gets the one generic error", async () => {
    const owner = await newSignedInUser("bound-owner");
    const stranger = await newSignedInUser("bound-stranger");
    // Minted like `invite-create.ts --email` with odd case and spaces: the binding ignores both.
    const code = await mintInviteCode({ email: `  ${owner.email.toUpperCase()} ` });

    const wrong = await redeem(stranger.client, code, newSlug("bound-x"));
    expect(wrong.data).toBeNull();
    expect(wrong.error).toMatchObject({ message: "code:forbidden", details: "invite code is not valid" });
    const [unspent] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(unspent.used_count).toBe(0);

    const right = await redeem(owner.client, code, newSlug("bound-ok"));
    expect(right.error).toBeNull();
    const [spent] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(spent.used_count).toBe(1);
  });

  it("peek_platform_invite_code: a bound code is true only for its email (case and spaces ignored); an unbound code for any email", async () => {
    const email = `school-setup-peek-${crypto.randomUUID()}@test.local`;
    const bound = await mintInviteCode({ email });
    const unbound = await mintInviteCode();
    const peek = async (code: string, candidate: string | null) =>
      (await sql`select public.peek_platform_invite_code(${code}, ${candidate}) as ok`)[0].ok as boolean;

    expect(await peek(bound, email)).toBe(true);
    expect(await peek(bound, `  ${email.toUpperCase()} `)).toBe(true);
    expect(await peek(bound, "someone-else@test.local")).toBe(false);
    expect(await peek(bound, null)).toBe(false);
    expect(await peek(unbound, "anyone@test.local")).toBe(true);
    expect(await peek(unbound, null)).toBe(true);
  });

  it("a one-use code works once: a second redeem and a concurrent race both get exactly one school", async () => {
    const first = await newSignedInUser("once-a");
    const second = await newSignedInUser("once-b");
    const code = await mintInviteCode();
    expect((await redeem(first.client, code, newSlug("once1"))).error).toBeNull();
    expect((await redeem(second.client, code, newSlug("once2"))).error?.message).toBe("code:forbidden");

    const raceCode = await mintInviteCode();
    const [a, b] = await Promise.all([
      redeem(first.client, raceCode, newSlug("race1")),
      redeem(second.client, raceCode, newSlug("race2")),
    ]);
    expect([a.error, b.error].filter((e) => e === null)).toHaveLength(1);
    expect([a.error?.message, b.error?.message]).toContain("code:forbidden");
    const [row] = await sql`select used_count, id from public.platform_invite_codes where code_hash = ${hashOf(raceCode)}`;
    expect(row.used_count).toBe(1);
    expect(await sql`select 1 from public.platform_invite_redemptions where invite_code_id = ${row.id}`).toHaveLength(1);
  });

  it("a slug failure after a valid code rolls back and leaves the code unspent", async () => {
    const { client } = await newSignedInUser("slug");
    const code = await mintInviteCode();
    const { error } = await redeem(client, code, "Bad_Slug");
    expect(error?.message).toBe("code:validation_failed");
    const [row] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(row.used_count).toBe(0);
  });

  it("app route slugs (start, platform, tour) are refused by the SQL reserved rule and leave the code unspent", async () => {
    const { client } = await newSignedInUser("reserved");
    const code = await mintInviteCode();
    for (const slug of ["start", "platform", "tour"]) {
      const { error } = await redeem(client, code, slug);
      expect(error).toMatchObject({ message: "code:validation_failed", details: "slug is reserved" });
    }
    const [row] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(row.used_count).toBe(0);
  });

  it("a signed-in user cannot call create_institution directly", async () => {
    const { client } = await newSignedInUser("direct");
    const { error } = await client.rpc("create_institution", { p_name: "Direct School", p_slug: newSlug("direct") });
    expect(error?.code).toBe("42501");
  });
});

describe("apply_school_template (0127)", () => {
  it("the owner of a fresh invite school applies the template once; a second run is a conflict", async () => {
    const { client } = await newSignedInUser("tpl");
    const { data } = await redeem(client, await mintInviteCode(), newSlug("tpl"));
    const institutionId = data![0].institution_id;

    const applied = await client.rpc("apply_school_template", { p_institution_id: institutionId, p_template: TEMPLATE as never });
    expect(applied.error).toBeNull();
    expect(applied.data).toMatchObject({ academic_years: 1, terms: 2, grades: 3, class_sections: 6, periods: 10, fee_structures: 3 });
    const [year] = await sql`select name, starts_on::text, is_current from public.academic_years where institution_id = ${institutionId}`;
    expect(year).toEqual({ name: "2026-27", starts_on: "2026-04-01", is_current: true });

    const again = await client.rpc("apply_school_template", { p_institution_id: institutionId, p_template: TEMPLATE as never });
    expect(again.error?.message).toBe("code:conflict");
  });

  it("out-of-bounds templates are rejected whole: nothing is written", async () => {
    const { client } = await newSignedInUser("bounds");
    const { data } = await redeem(client, await mintInviteCode(), newSlug("bounds"));
    const institutionId = data![0].institution_id;
    const grade = TEMPLATE.grades[0];
    const tooMany = [
      { ...TEMPLATE, grades: Array.from({ length: 16 }, (_, i) => ({ ...grade, code: `G${i}` })) },
      { ...TEMPLATE, grades: [{ ...grade, sections: ["A", "B", "C", "D", "E", "F", "G", "H", "I"] }] },
      { ...TEMPLATE, grades: [{ ...grade, subjects: Array.from({ length: 16 }, (_, i) => ({ code: `S${i}`, name: `S${i}`, kind: "scholastic" })) }] },
      { ...TEMPLATE, fee_structure: { name: "Fees", components: [{ head: "tuition", frequency: "monthly", amount_paise: 1.5 }] } },
    ];
    for (const template of tooMany) {
      const { error } = await client.rpc("apply_school_template", { p_institution_id: institutionId, p_template: template as never });
      expect(error?.message).toBe("code:validation_failed");
    }
    expect(await sql`select 1 from public.grades where institution_id = ${institutionId}`).toHaveLength(0);
  });
});

describe("core.setup.* actions and apply_school_template role checks", () => {
  let a: TestInstitution;
  let b: TestInstitution;

  beforeAll(async () => {
    a = await createTestInstitution("setup-a");
    b = await createTestInstitution("setup-b");
  }, 120_000);

  afterAll(async () => {
    await a.cleanup();
    await b.cleanup();
  }, 120_000);

  it("a principal/admin of the school and an owner of another school are refused", async () => {
    for (const role of ["principal", "admin"] as const) {
      const { error } = await a.clientAs(role).rpc("apply_school_template", { p_institution_id: a.institutionId, p_template: TEMPLATE as never });
      expect(error?.message).toBe("code:forbidden");
    }
    const crossTenant = await a.clientAs("owner").rpc("apply_school_template", { p_institution_id: b.institutionId, p_template: TEMPLATE as never });
    expect(crossTenant.error?.message).toBe("code:forbidden");
    expect(await sql`select 1 from public.grades where institution_id in ${sql([a.institutionId, b.institutionId])}`).toHaveLength(0);

    const viaAction = await callAs(a, "admin", applyTemplate, { board: "CBSE", fromGrade: "I", toGrade: "II", sectionsPerGrade: 1 });
    expect(viaAction).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("owner: applyTemplate builds the template server-side, then conflict; status reflects it", async () => {
    const before = await callAs(a, "owner", setupStatusQuery, {});
    expect(before).toMatchObject({ ok: true, data: { total: 5, complete: false, counts: { grades: 0 } } });
    expect(before.ok && before.data.steps.find((s) => s.key === "structure")?.state).toBe("todo");

    const choices = { board: "ICSE", fromGrade: "LKG", toGrade: "II", sectionsPerGrade: 3, yearStart: "2026-04-01" };
    const first = await callAs(a, "owner", applyTemplate, choices);
    expect(first).toMatchObject({ ok: true, data: { grades: 4, class_sections: 12 } });
    const second = await callAs(a, "owner", applyTemplate, choices);
    expect(second).toMatchObject({ ok: false, error: { code: "conflict" } });

    const after = await callAs(a, "owner", setupStatusQuery, {});
    expect(after.ok && after.data.steps.find((s) => s.key === "structure")?.state).toBe("done");
    expect(after.ok && after.data.counts.grades).toBe(4);
  });

  it("saveBranding rejects a logo path in another school's folder, then stores the colour", async () => {
    const foreign = await callAs(b, "owner", saveBranding, { logoPath: `${a.institutionId}/logo.png` });
    expect(foreign).toMatchObject({ ok: false, error: { code: "validation_failed" } });

    const saved = await callAs(b, "owner", saveBranding, { primaryColor: "#0A7B83" });
    expect(saved).toMatchObject({ ok: true, data: { primary_color: "#0a7b83" } });
    const [row] = await sql`select settings -> 'branding' as branding from public.institutions where id = ${b.institutionId}`;
    expect(row.branding).toEqual({ primary_color: "#0a7b83" });
  });

  it("school-branding bucket: teacher, another school's admin and svg are refused; this school's admin writes, anyone reads", async () => {
    type Client = ReturnType<TestInstitution["clientAs"]>;
    const path = `${a.institutionId}/logo.png`;
    const upload = (client: Client, objectPath = path, type = "image/png") =>
      client.storage.from("school-branding").upload(objectPath, new Blob([PNG_1X1], { type }), { upsert: true, contentType: type });
    try {
      expect((await upload(a.clientAs("teacher"))).error).not.toBeNull();
      expect((await upload(b.clientAs("admin"))).error).not.toBeNull();
      expect((await upload(a.clientAs("owner"), `${a.institutionId}/logo.svg`, "image/svg+xml")).error).not.toBeNull();
      expect((await upload(a.clientAs("owner"), path, "image/svg+xml")).error).not.toBeNull();
      expect(await sql`select 1 from storage.objects where bucket_id = 'school-branding' and name like ${`${a.institutionId}/%`}`).toHaveLength(0);

      expect((await upload(a.clientAs("admin"))).error).toBeNull();
      expect(await callAs(a, "admin", saveBranding, { logoPath: path })).toMatchObject({ ok: true, data: { logo_path: path } });
      const url = a.clientAs("student").storage.from("school-branding").getPublicUrl(path).data.publicUrl;
      expect((await fetch(url)).status).toBe(200);
    } finally {
      await adminClient().storage.from("school-branding").remove([path]);
    }
  });

  it("setProgress marks, dismisses and clears a step without touching other settings", async () => {
    expect(await callAs(b, "owner", setProgress, { step: "invite", state: "dismissed" })).toMatchObject({
      ok: true,
      data: { invite: "dismissed" },
    });
    const status = await callAs(b, "owner", setupStatusQuery, {});
    expect(status.ok && status.data.steps.find((s) => s.key === "invite")?.state).toBe("dismissed");

    expect(await callAs(b, "owner", setProgress, { step: "invite", state: "todo" })).toMatchObject({ ok: true, data: {} });
    const [row] = await sql`select settings from public.institutions where id = ${b.institutionId}`;
    expect(row.settings.setup).toEqual({});
    expect(row.settings.modules).toBeDefined();

    const teacher = await callAs(b, "teacher", setProgress, { step: "people", state: "done" });
    expect(teacher).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});
