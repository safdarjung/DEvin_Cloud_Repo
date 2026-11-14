import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { saveSchoolName } from "@/modules/core/setup/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// D58 — Settings → School profile: a school renames itself; the shared demo school cannot be renamed.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});
const created: TestInstitution[] = [];
afterEach(async () => {
  // The fixture's cleanup (app.demo_reset) only accepts demo schools.
  await Promise.all(
    created.splice(0).map(async (inst) => {
      await sql`update public.institutions set is_demo = true where id = ${inst.institutionId}`;
      await inst.cleanup();
    }),
  );
});

async function nameOf(id: string): Promise<string> {
  const [row] = await sql`select name from public.institutions where id = ${id}`;
  return row.name as string;
}

describe("school profile: saveSchoolName", () => {
  it("a principal renames their own school", async () => {
    const inst = await createTestInstitution("school-rename");
    created.push(inst);
    await sql`update public.institutions set is_demo = false where id = ${inst.institutionId}`;
    const result = await callAs(inst, "principal", saveSchoolName, { name: "  Green Valley School  " });
    expect(result).toMatchObject({ ok: true, data: { name: "Green Valley School" } });
    expect(await nameOf(inst.institutionId)).toBe("Green Valley School");
  });

  it("a teacher cannot rename the school", async () => {
    const inst = await createTestInstitution("school-rename-teacher");
    created.push(inst);
    await sql`update public.institutions set is_demo = false where id = ${inst.institutionId}`;
    const before = await nameOf(inst.institutionId);
    const result = await callAs(inst, "teacher", saveSchoolName, { name: "Hijacked" });
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await nameOf(inst.institutionId)).toBe(before);
  });

  it("the shared demo school's name is locked, even for its principal", async () => {
    const inst = await createTestInstitution("school-rename-demo");
    created.push(inst);
    const before = await nameOf(inst.institutionId);
    const result = await callAs(inst, "principal", saveSchoolName, { name: "Renamed Demo" });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(await nameOf(inst.institutionId)).toBe(before);
  });
});
