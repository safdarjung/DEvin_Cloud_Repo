// GU-07 (D32, 14-generative-ui-plan.md) — study_items/study_preferences
// RLS: own-rows-only, for EVERY role, with no staff/owner/principal/admin
// bypass of any kind (unlike almost every other table in this schema).
// Cross-institution SELECT isolation for every role is already covered
// generically by tests/security/rls-generated.test.ts (C-01) once the
// rls-expectations.ts entry exists; this file covers what that generic
// suite doesn't: no staff bypass within the SAME institution, cross-
// institution INSERT (not just SELECT), identity-column immutability
// (database-reviewer L3/H1), and C-68's own-row read/write/delete shape.
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ROLES, closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

describe("study_items RLS (C-68)", () => {
  it("a student can insert, read, update, and hard-delete their own row", async () => {
    const inst = await createTestInstitution("study-items-own");
    createdInstitutions.push(inst);
    const student = inst.clientAs("student");

    const inserted = await student
      .from("study_items")
      .insert({ institution_id: inst.institutionId, user_id: inst.users.student.id, kind: "note", title: "My note", content: { questions: [] } })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    const itemId = inserted.data?.id;

    const read = await student.from("study_items").select("id, title").eq("id", itemId);
    expect(read.data).toHaveLength(1);
    expect(read.data?.[0].title).toBe("My note");

    const updated = await student.from("study_items").update({ pinned: true }).eq("id", itemId).select("pinned");
    expect(updated.data?.[0].pinned).toBe(true);

    const deleted = await student.from("study_items").delete().eq("id", itemId).select("id");
    expect(deleted.data).toHaveLength(1);

    const afterDelete = await sql`select id from public.study_items where id = ${itemId}::uuid`;
    expect(afterDelete).toHaveLength(0);
  });

  it("no role — not even owner/principal/admin — can read another member's study_items row", async () => {
    const inst = await createTestInstitution("study-items-no-bypass");
    createdInstitutions.push(inst);

    const [row] = await sql`
      insert into public.study_items (institution_id, user_id, kind, title, content)
      values (${inst.institutionId}, ${inst.users.student.id}, 'note', 'Private note', '{}'::jsonb)
      returning id
    `;

    for (const role of ROLES) {
      if (role === "student") continue; // the owner's own read is covered above
      const { data, error } = await inst.clientAs(role).from("study_items").select("id").eq("id", row.id);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    }
  });

  it("no role — not even owner/principal/admin — can update or delete another member's study_items row", async () => {
    const inst = await createTestInstitution("study-items-no-write-bypass");
    createdInstitutions.push(inst);

    const [row] = await sql`
      insert into public.study_items (institution_id, user_id, kind, title, content, pinned)
      values (${inst.institutionId}, ${inst.users.student.id}, 'note', 'Private note', '{}'::jsonb, false)
      returning id
    `;

    for (const role of ["owner", "principal", "admin"] as const) {
      const client = inst.clientAs(role);
      const updated = await client.from("study_items").update({ pinned: true }).eq("id", row.id).select("id");
      expect(updated.data ?? []).toHaveLength(0);
      const deleted = await client.from("study_items").delete().eq("id", row.id).select("id");
      expect(deleted.data ?? []).toHaveLength(0);
    }

    const stillThere = await sql`select pinned from public.study_items where id = ${row.id}::uuid`;
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].pinned).toBe(false);
  });

  it("a different member cannot read, update, or delete this student's row, and it is left unchanged", async () => {
    const inst = await createTestInstitution("study-items-cross-student");
    createdInstitutions.push(inst);

    const [row] = await sql`
      insert into public.study_items (institution_id, user_id, kind, title, content, pinned)
      values (${inst.institutionId}, ${inst.users.student.id}, 'note', 'Private note', '{}'::jsonb, false)
      returning id
    `;

    // No second student fixture user exists on a single TestInstitution —
    // guardian's own user_id is a different auth user in the same
    // institution, which is enough to prove "not this exact user_id",
    // the same boundary a second student would hit.
    const other = inst.clientAs("guardian");
    const read = await other.from("study_items").select("id").eq("id", row.id);
    expect(read.data).toHaveLength(0);

    const updated = await other.from("study_items").update({ pinned: true }).eq("id", row.id).select("id");
    expect(updated.data ?? []).toHaveLength(0);

    const deleted = await other.from("study_items").delete().eq("id", row.id).select("id");
    expect(deleted.data ?? []).toHaveLength(0);

    const stillThere = await sql`select pinned from public.study_items where id = ${row.id}::uuid`;
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].pinned).toBe(false);
  });

  it("cannot insert a row for a different user_id than the caller's own (42501)", async () => {
    const inst = await createTestInstitution("study-items-forge-user");
    createdInstitutions.push(inst);
    const student = inst.clientAs("student");

    const result = await student
      .from("study_items")
      .insert({ institution_id: inst.institutionId, user_id: inst.users.guardian.id, kind: "note", title: "Forged", content: {} })
      .select("id");

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe("42501");
    expect(result.data ?? []).toHaveLength(0);
  });

  it("cannot insert into an institution the caller isn't a member of", async () => {
    const instA = await createTestInstitution("study-items-cross-inst-a");
    const instB = await createTestInstitution("study-items-cross-inst-b");
    createdInstitutions.push(instA, instB);

    const result = await instA
      .clientAs("student")
      .from("study_items")
      .insert({ institution_id: instB.institutionId, user_id: instA.users.student.id, kind: "note", title: "Cross-institution", content: {} })
      .select("id");

    expect(result.error).not.toBeNull();
    expect(result.data ?? []).toHaveLength(0);
  });

  it("cannot reassign a row's user_id to someone else via UPDATE (42501)", async () => {
    const inst = await createTestInstitution("study-items-reassign");
    createdInstitutions.push(inst);
    const student = inst.clientAs("student");

    const inserted = await student
      .from("study_items")
      .insert({ institution_id: inst.institutionId, user_id: inst.users.student.id, kind: "note", title: "Mine", content: {} })
      .select("id")
      .single();
    const itemId = inserted.data?.id;

    const result = await student.from("study_items").update({ user_id: inst.users.guardian.id }).eq("id", itemId).select("id");
    expect(result.data ?? []).toHaveLength(0);

    const unchanged = await sql`select user_id from public.study_items where id = ${itemId}::uuid`;
    expect(unchanged[0].user_id).toBe(inst.users.student.id);
  });

  it("the guard trigger itself blocks changing institution_id, independent of RLS/membership", async () => {
    // Direct service-role SQL (bypasses RLS entirely) isolates the
    // trigger's own check from the RLS/membership question — a student
    // who is a member of a second institution would also be blocked by
    // `app.is_member` at the RLS layer before ever reaching this trigger;
    // this test proves the trigger blocks it on its own regardless.
    const instA = await createTestInstitution("study-items-move-a");
    const instB = await createTestInstitution("study-items-move-b");
    createdInstitutions.push(instA, instB);

    const [row] = await sql`
      insert into public.study_items (institution_id, user_id, kind, title, content)
      values (${instA.institutionId}, ${instA.users.student.id}, 'note', 'Mine', '{}'::jsonb)
      returning id
    `;

    await expect(
      sql`update public.study_items set institution_id = ${instB.institutionId} where id = ${row.id}::uuid`,
    ).rejects.toThrow();

    const unchanged = await sql`select institution_id from public.study_items where id = ${row.id}::uuid`;
    expect(unchanged[0].institution_id).toBe(instA.institutionId);
  });

  it("deleting a 'chat' row succeeds and nulls out a 'note' row's source_chat_id, instead of being blocked (the H1 fix)", async () => {
    const inst = await createTestInstitution("study-items-source-delete");
    createdInstitutions.push(inst);

    const [chat] = await sql`
      insert into public.study_items (institution_id, user_id, kind, title, content)
      values (${inst.institutionId}, ${inst.users.student.id}, 'chat', 'A chat', '{}'::jsonb)
      returning id
    `;
    const [note] = await sql`
      insert into public.study_items (institution_id, user_id, kind, title, content, source_chat_id)
      values (${inst.institutionId}, ${inst.users.student.id}, 'note', 'Notes from the chat', '{}'::jsonb, ${chat.id})
      returning id
    `;

    const deleted = await inst.clientAs("student").from("study_items").delete().eq("id", chat.id).select("id");
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(1);

    const noteAfter = await sql`select source_chat_id from public.study_items where id = ${note.id}::uuid`;
    expect(noteAfter[0].source_chat_id).toBeNull();
  });

  it("rejects content over the ~256 KB cap, and accepts content comfortably under it", async () => {
    const inst = await createTestInstitution("study-items-size-cap");
    createdInstitutions.push(inst);

    const tooBig = { blob: "x".repeat(300_000) };
    await expect(
      sql`insert into public.study_items (institution_id, user_id, kind, title, content)
          values (${inst.institutionId}, ${inst.users.student.id}, 'note', 'Too big', ${sql.json(tooBig)})`,
    ).rejects.toMatchObject({ code: "23514" });

    const fine = { blob: "x".repeat(1000) };
    const ok = await sql`
      insert into public.study_items (institution_id, user_id, kind, title, content)
      values (${inst.institutionId}, ${inst.users.student.id}, 'note', 'Fine', ${sql.json(fine)})
      returning id
    `;
    expect(ok).toHaveLength(1);
  });
});

describe("study_preferences RLS (C-68)", () => {
  it("a student can upsert, read, and delete their own preferences row; no other role can read or write it", async () => {
    const inst = await createTestInstitution("study-prefs-own");
    createdInstitutions.push(inst);
    const student = inst.clientAs("student");

    const upserted = await student
      .from("study_preferences")
      .upsert({ institution_id: inst.institutionId, user_id: inst.users.student.id, skills: ["terse"], style: { language: "en" } })
      .select("skills");
    expect(upserted.error).toBeNull();
    expect(upserted.data?.[0].skills).toEqual(["terse"]);

    for (const role of ROLES) {
      if (role === "student") continue;
      const client = inst.clientAs(role);
      const read = await client
        .from("study_preferences")
        .select("user_id")
        .eq("institution_id", inst.institutionId)
        .eq("user_id", inst.users.student.id);
      expect(read.error).toBeNull();
      expect(read.data).toHaveLength(0);

      const write = await client
        .from("study_preferences")
        .update({ skills: ["eli5"] })
        .eq("institution_id", inst.institutionId)
        .eq("user_id", inst.users.student.id)
        .select("user_id");
      expect(write.data ?? []).toHaveLength(0);
    }

    const deleted = await student
      .from("study_preferences")
      .delete()
      .eq("institution_id", inst.institutionId)
      .eq("user_id", inst.users.student.id)
      .select("user_id");
    expect(deleted.data).toHaveLength(1);
  });

  it("rejects a skills/style payload over its 8 KB cap", async () => {
    const inst = await createTestInstitution("study-prefs-size-cap");
    createdInstitutions.push(inst);

    await expect(
      sql`insert into public.study_preferences (institution_id, user_id, style)
          values (${inst.institutionId}, ${inst.users.student.id}, ${sql.json({ myStyle: "x".repeat(9000) })})`,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects skills that isn't a JSON array, and style that isn't a JSON object", async () => {
    const inst = await createTestInstitution("study-prefs-shape");
    createdInstitutions.push(inst);

    await expect(
      sql`insert into public.study_preferences (institution_id, user_id, skills)
          values (${inst.institutionId}, ${inst.users.student.id}, '"not-an-array"'::jsonb)`,
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      sql`insert into public.study_preferences (institution_id, user_id, style)
          values (${inst.institutionId}, ${inst.users.student.id}, '["not", "an", "object"]'::jsonb)`,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
