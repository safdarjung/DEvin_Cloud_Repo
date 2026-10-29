import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 1 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("C-02: disabled membership loses access immediately", () => {
  it("flips status and re-queries", async () => {
    const inst = await createTestInstitution("membership-status");
    try {
      const before = await inst
        .clientAs("teacher")
        .from("institutions")
        .select("id")
        .eq("id", inst.institutionId);
      expect(before.data).toHaveLength(1);

      await sql`
        update public.memberships set status = 'disabled'
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.teacher.id}
      `;

      const after = await inst
        .clientAs("teacher")
        .from("institutions")
        .select("id")
        .eq("id", inst.institutionId);
      expect(after.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });
});
