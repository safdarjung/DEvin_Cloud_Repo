// Curveball sweep (notifications): markRead had no db test — own row, someone else's row, other school, re-read.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { markRead } from "@/modules/notifications/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let a: TestInstitution;
let b: TestInstitution;

async function note(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const [row] = await sql`
    insert into public.notifications (institution_id, recipient_user_id, type, title, body)
    values (${inst.institutionId}, ${inst.users[role].id}, 'test.curveball', 'Hello', 'Body') returning id`;
  return row.id as string;
}
async function readAt(id: string): Promise<string | null> {
  const [row] = await sql`select read_at::text as r from public.notifications where id = ${id}`;
  return row.r as string | null;
}

beforeAll(async () => {
  a = await createTestInstitution("notif-cb");
  b = await createTestInstitution("notif-cb-x");
});

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("markRead curveballs", () => {
  it("every role marks its own notification read", async () => {
    for (const role of ["owner", "teacher", "student", "guardian", "accountant"] as const) {
      const id = await note(a, role);
      const r = await callAs(a, role, markRead, { notificationId: id });
      expect(r.ok ? r.data.id : r.error.code).toBe(id);
      expect(await readAt(id)).not.toBeNull();
    }
  });

  it("someone else's notification (even as owner) → not_found and stays unread", async () => {
    const id = await note(a, "guardian");
    const r = await callAs(a, "owner", markRead, { notificationId: id });
    expect(r.ok ? null : r.error.code).toBe("not_found");
    expect(await readAt(id)).toBeNull();
  });

  it("another school's notification and an unknown id → not_found", async () => {
    const theirs = await note(b, "teacher");
    const r = await callAs(a, "teacher", markRead, { notificationId: theirs });
    expect(r.ok ? null : r.error.code).toBe("not_found");
    expect(await readAt(theirs)).toBeNull();
    const unknown = await callAs(a, "teacher", markRead, { notificationId: crypto.randomUUID() });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
  });

  it("non-uuid id → validation_failed on notificationId", async () => {
    const r = await callAs(a, "teacher", markRead, { notificationId: "1" });
    expect(r.ok ? null : r.error.fieldErrors?.notificationId).toBeTruthy();
  });

  // Regression (fixed): The action always writes read_at = now(); a second click moves the first-read time forward.
  it("marking an already-read notification keeps its original read_at", async () => {
    const id = await note(a, "teacher");
    expect((await callAs(a, "teacher", markRead, { notificationId: id })).ok).toBe(true);
    const first = await readAt(id);
    await new Promise((r) => setTimeout(r, 20));
    expect((await callAs(a, "teacher", markRead, { notificationId: id })).ok).toBe(true);
    expect(await readAt(id)).toBe(first);
  });
});
