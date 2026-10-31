import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { deleteStudyItem, saveStudyChat, saveStudyNote, updateStudyItem } from "@/modules/ai/student-study.actions";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { ROLES, closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function enableNotebook(inst: TestInstitution): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features}', '{"student_ai_study": true, "student_ai_notebook": true}'::jsonb)
    where id = ${inst.institutionId}
  `;
}

function validMessages() {
  return [{ id: "m1", role: "user" as const, parts: [{ type: "text", text: "Explain fractions" }] }];
}

function validBlocks() {
  return [{ kind: "callout" as const, tone: "tip" as const, text: "Remember this." }];
}

describe("saveStudyChat / saveStudyNote (GU-09, D32)", () => {
  it("a student can save a chat, then only they can read it", async () => {
    const inst = await createTestInstitution("study-save-chat");
    await enableNotebook(inst);

    const result = await callAs(inst, "student", saveStudyChat, { title: "My chat", messages: validMessages() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await sql`select kind, title, content, user_id from public.study_items where id = ${result.data.id}::uuid`;
    expect(row.kind).toBe("chat");
    expect(row.title).toBe("My chat");
    expect(row.content.messages).toEqual(validMessages());
    expect(row.user_id).toBe(inst.users.student.id);
  });

  it("a student can save a note with blocks", async () => {
    const inst = await createTestInstitution("study-save-note");
    await enableNotebook(inst);

    const result = await callAs(inst, "student", saveStudyNote, { title: "My note", blocks: validBlocks() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await sql`select kind, content from public.study_items where id = ${result.data.id}::uuid`;
    expect(row.kind).toBe("note");
    expect(row.content.blocks).toEqual(validBlocks());
  });

  it("rejects a note with an invalid block (schema-level, before the handler ever runs)", async () => {
    const inst = await createTestInstitution("study-save-note-invalid");
    await enableNotebook(inst);

    const ctx = await buildContext(inst, "student");
    const result = await saveStudyNote(inst.slug, { title: "Bad note", blocks: [{ kind: "callout", tone: "danger", text: "x" }] }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });

  it("returns ai_unavailable when student_ai_notebook is off", async () => {
    const inst = await createTestInstitution("study-save-notebook-off");
    await sql`
      update public.institutions
      set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features}', '{"student_ai_study": true, "student_ai_notebook": false}'::jsonb)
      where id = ${inst.institutionId}
    `;

    const result = await callAs(inst, "student", saveStudyChat, { title: "x", messages: validMessages() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ai_unavailable");
  });

  it("no other role can save a study item (ai.study is student-only)", async () => {
    const inst = await createTestInstitution("study-save-forbidden");
    await enableNotebook(inst);

    for (const role of ROLES) {
      if (role === "student") continue;
      const result = await callAs(inst, role, saveStudyChat, { title: "x", messages: validMessages() });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("forbidden");
    }
  });

  it("enforces the per-student item cap", async () => {
    const inst = await createTestInstitution("study-save-cap");
    await enableNotebook(inst);

    for (let i = 0; i < 200; i++) {
      await sql`
        insert into public.study_items (institution_id, user_id, kind, title, content)
        values (${inst.institutionId}, ${inst.users.student.id}, 'note', ${`Item ${i}`}, ${sql.json({ blocks: validBlocks() })})
      `;
    }

    const result = await callAs(inst, "student", saveStudyNote, { title: "One too many", blocks: validBlocks() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
    expect(result.error.message).toMatch(/limit/i);
  });

  it("audit_events for save, update, and delete never contain the title or message/block content", async () => {
    const inst = await createTestInstitution("study-save-audit");
    await enableNotebook(inst);

    const saveSecret = "Secret topic — explain fractions";
    const saved = await callAs(inst, "student", saveStudyChat, {
      title: "Secret topic",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: saveSecret }] }],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    await callAs(inst, "student", updateStudyItem, { itemId: saved.data.id, title: "Renamed secret topic" });
    await callAs(inst, "student", deleteStudyItem, { itemId: saved.data.id });

    // `createTestInstitution` itself logs `membership.changed` events for
    // the fixture's own role users — filtered out here, not relevant to
    // what this test checks.
    const allEvents = await sql`select action, entity_id, before, after, metadata from public.audit_events where institution_id = ${inst.institutionId}`;
    const events = allEvents.filter((e) => e.action.startsWith("ai.study."));
    expect(events.map((e) => e.action).sort()).toEqual(["ai.study.chat.save", "ai.study.item.delete", "ai.study.item.update"]);
    for (const event of events) {
      const serialized = JSON.stringify([event.before, event.after, event.metadata]);
      expect(serialized).not.toContain("Secret topic");
      expect(serialized).not.toContain("Renamed secret topic");
      expect(serialized).not.toContain(saveSecret);
      expect(serialized).not.toContain("fractions");
    }
  });
});

describe("updateStudyItem / deleteStudyItem (GU-09)", () => {
  it("the owning student can rename, move to a folder, and pin their own item", async () => {
    const inst = await createTestInstitution("study-update-own");
    await enableNotebook(inst);
    const saved = await callAs(inst, "student", saveStudyNote, { title: "Original", blocks: validBlocks() });
    if (!saved.ok) throw new Error("setup failed");

    const updated = await callAs(inst, "student", updateStudyItem, {
      itemId: saved.data.id,
      title: "Renamed",
      folder: "Maths",
      pinned: true,
    });
    expect(updated.ok).toBe(true);

    const [row] = await sql`select title, folder, pinned from public.study_items where id = ${saved.data.id}::uuid`;
    expect(row).toEqual({ title: "Renamed", folder: "Maths", pinned: true });
  });

  it("a different member cannot update or delete this student's item", async () => {
    const inst = await createTestInstitution("study-update-cross-user");
    await enableNotebook(inst);
    const saved = await callAs(inst, "student", saveStudyNote, { title: "Original", blocks: validBlocks() });
    if (!saved.ok) throw new Error("setup failed");

    const updated = await callAs(inst, "guardian", updateStudyItem, { itemId: saved.data.id, pinned: true });
    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error.code).toBe("forbidden");

    // `hasPermission` derives from `ctx.membership.role` alone (never
    // `ctx.permissions`), so tampering with that Set specifically grants
    // nothing. (A real caller forging a THIRD argument over the wire —
    // the actual CRITICAL finding this GU-09 review surfaced — is a
    // separate, now-fixed issue in define-action.ts itself, unrelated to
    // this Set; see that file's own comment.) This test instead reaches
    // RLS as the real backstop the direct way: a `role: "student"` ctx
    // (passes the permission gate) for a DIFFERENT user_id than the
    // item's owner (same role, same permission, different identity).
    const studentCtx = await buildContext(inst, "student");
    const otherStudentCtx = { ...studentCtx, user: { ...studentCtx.user, id: inst.users.guardian.id } };
    setActingClient(inst.clientAs("guardian") as unknown as Parameters<typeof setActingClient>[0]);
    let forced: Awaited<ReturnType<typeof updateStudyItem>>;
    try {
      forced = await updateStudyItem(inst.slug, { itemId: saved.data.id, pinned: true }, otherStudentCtx);
    } finally {
      setActingClient(null);
    }
    expect(forced.ok).toBe(false);
    if (!forced.ok) expect(forced.error.code).toBe("not_found");

    const [row] = await sql`select pinned from public.study_items where id = ${saved.data.id}::uuid`;
    expect(row.pinned).toBe(false);
  });

  it("returns not_found for a non-existent item", async () => {
    const inst = await createTestInstitution("study-update-missing");
    await enableNotebook(inst);
    const result = await callAs(inst, "student", updateStudyItem, { itemId: crypto.randomUUID(), pinned: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("the owning student can hard-delete their own item", async () => {
    const inst = await createTestInstitution("study-delete-own");
    await enableNotebook(inst);
    const saved = await callAs(inst, "student", saveStudyNote, { title: "To delete", blocks: validBlocks() });
    if (!saved.ok) throw new Error("setup failed");

    const deleted = await callAs(inst, "student", deleteStudyItem, { itemId: saved.data.id });
    expect(deleted.ok).toBe(true);

    const rows = await sql`select id from public.study_items where id = ${saved.data.id}::uuid`;
    expect(rows).toHaveLength(0);
  });

  it("a different member cannot delete this student's item (test gap closed per GU-09 review)", async () => {
    const inst = await createTestInstitution("study-delete-cross-user");
    await enableNotebook(inst);
    const saved = await callAs(inst, "student", saveStudyNote, { title: "Not yours", blocks: validBlocks() });
    if (!saved.ok) throw new Error("setup failed");

    const deleted = await callAs(inst, "guardian", deleteStudyItem, { itemId: saved.data.id });
    expect(deleted.ok).toBe(false);
    if (!deleted.ok) expect(deleted.error.code).toBe("forbidden");

    const rows = await sql`select id from public.study_items where id = ${saved.data.id}::uuid`;
    expect(rows).toHaveLength(1);
  });
});

describe("saveStudyNote sourceChatId (GU-09 security review L1)", () => {
  it("links to the caller's own chat item", async () => {
    const inst = await createTestInstitution("study-source-chat-own");
    await enableNotebook(inst);
    const chat = await callAs(inst, "student", saveStudyChat, { title: "A chat", messages: validMessages() });
    if (!chat.ok) throw new Error("setup failed");

    const note = await callAs(inst, "student", saveStudyNote, { title: "Notes", blocks: validBlocks(), sourceChatId: chat.data.id });
    expect(note.ok).toBe(true);
    if (!note.ok) return;

    const [row] = await sql`select source_chat_id from public.study_items where id = ${note.data.id}::uuid`;
    expect(row.source_chat_id).toBe(chat.data.id);
  });

  it("silently drops a sourceChatId pointing at another student's chat, instead of linking or erroring", async () => {
    const instA = await createTestInstitution("study-source-chat-cross-a");
    const instB = await createTestInstitution("study-source-chat-cross-b");
    await enableNotebook(instA);
    await enableNotebook(instB);
    const otherChat = await callAs(instB, "student", saveStudyChat, { title: "Someone else's chat", messages: validMessages() });
    if (!otherChat.ok) throw new Error("setup failed");

    const note = await callAs(instA, "student", saveStudyNote, {
      title: "Notes",
      blocks: validBlocks(),
      sourceChatId: otherChat.data.id,
    });
    expect(note.ok).toBe(true);
    if (!note.ok) return;

    const [row] = await sql`select source_chat_id from public.study_items where id = ${note.data.id}::uuid`;
    expect(row.source_chat_id).toBeNull();
  });

  it("silently drops a sourceChatId pointing at a note, not a chat", async () => {
    const inst = await createTestInstitution("study-source-chat-wrong-kind");
    await enableNotebook(inst);
    const otherNote = await callAs(inst, "student", saveStudyNote, { title: "A note", blocks: validBlocks() });
    if (!otherNote.ok) throw new Error("setup failed");

    const note = await callAs(inst, "student", saveStudyNote, {
      title: "Notes",
      blocks: validBlocks(),
      sourceChatId: otherNote.data.id,
    });
    expect(note.ok).toBe(true);
    if (!note.ok) return;

    const [row] = await sql`select source_chat_id from public.study_items where id = ${note.data.id}::uuid`;
    expect(row.source_chat_id).toBeNull();
  });
});

describe("study_items cap trigger (GU-09 security review M1)", () => {
  it("blocks a direct Data API insert past the 200-item cap, even though RLS alone would permit it", async () => {
    const inst = await createTestInstitution("study-cap-trigger-direct");
    await enableNotebook(inst);

    for (let i = 0; i < 200; i++) {
      await sql`
        insert into public.study_items (institution_id, user_id, kind, title, content)
        values (${inst.institutionId}, ${inst.users.student.id}, 'note', ${`Item ${i}`}, ${sql.json({ blocks: validBlocks() })})
      `;
    }

    const student = inst.clientAs("student");
    const result = await student
      .from("study_items")
      .insert({ institution_id: inst.institutionId, user_id: inst.users.student.id, kind: "note", title: "One too many", content: { blocks: validBlocks() } })
      .select("id");

    // PostgREST surfaces the raised exception's MESSAGE text here
    // ("code:validation_failed") — the human-readable "limit reached"
    // text is in the exception's DETAIL, which `mapSqlError` (the app's
    // own action path) reads separately; a direct Data API call like
    // this one only sees the raw Postgres error shape.
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("code:validation_failed");
    expect(result.data ?? []).toHaveLength(0);

    const count = await sql`select count(*)::int from public.study_items where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}`;
    expect(count[0].count).toBe(200);
  });
});
