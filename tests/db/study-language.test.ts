import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { updateStudyLanguage } from "@/modules/ai/student-study.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("updateStudyLanguage (DBT-160)", () => {
  it("a student saves a language, and a second save keeps other style keys", async () => {
    const inst = await createTestInstitution("study-language");

    const first = await callAs(inst, "student", updateStudyLanguage, { language: "ta" });
    expect(first.ok).toBe(true);
    const [row] = await sql`select style from public.study_preferences where user_id = ${inst.users.student.id}::uuid`;
    expect(row.style.language).toBe("ta");

    await sql`update public.study_preferences set style = style || '{"notesDensity":"brief"}'::jsonb where user_id = ${inst.users.student.id}::uuid`;
    const second = await callAs(inst, "student", updateStudyLanguage, { language: "hi" });
    expect(second.ok).toBe(true);
    const [after] = await sql`select style from public.study_preferences where user_id = ${inst.users.student.id}::uuid`;
    expect(after.style).toEqual({ language: "hi", notesDensity: "brief" });
  });

  it.each(["teacher", "guardian"] as const)("%s gets forbidden", async (role) => {
    const inst = await createTestInstitution(`study-language-${role}`);
    const result = await callAs(inst, role, updateStudyLanguage, { language: "hi" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });
});
