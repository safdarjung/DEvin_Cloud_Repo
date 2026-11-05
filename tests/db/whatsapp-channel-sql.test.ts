// X05-T1 — migration 20261028000089: delivery_attempts.channel and
// notification_preferences.channel checks widened to accept 'whatsapp';
// app.module_catalog gains the 'whatsapp' key (mirrors src/lib/modules/
// catalog.ts MODULES.whatsapp, 0084 MOD-T12 pattern). The
// notification_preferences_category_check (0074) is untouched and out of
// scope here.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const bareInstitutionIds: string[] = [];

afterAll(async () => {
  if (bareInstitutionIds.length > 0) {
    await sql`delete from public.institutions where id in ${sql(bareInstitutionIds)}`;
  }
  await sql.end();
  await closeRolesHelper();
});

async function createBareInstitution(settings: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into public.institutions (id, slug, name, settings)
    values (${id}, ${`test-x05-t1-${id}`}, 'X05-T1 test', ${sql.json(JSON.parse(JSON.stringify(settings)))})
  `;
  bareInstitutionIds.push(id);
  return id;
}

describe("migration 20261028000089: notification_preferences.channel accepts whatsapp", () => {
  it("a guardian upserts their own whatsapp preference over PostgREST", async () => {
    const inst = await createTestInstitution("notif-pref-whatsapp");
    try {
      const { error } = await inst.clientAs("guardian").from("notification_preferences").insert({
        institution_id: inst.institutionId,
        user_id: inst.users.guardian.id,
        category: "announcement",
        channel: "whatsapp",
        enabled: false,
      });
      expect(error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("an unknown channel is rejected (23514)", async () => {
    const inst = await createTestInstitution("notif-pref-bad-channel");
    try {
      const { error } = await inst.clientAs("guardian").from("notification_preferences").insert({
        institution_id: inst.institutionId,
        user_id: inst.users.guardian.id,
        category: "announcement",
        channel: "telegram",
        enabled: false,
      });
      expect(error?.code).toBe("23514");
    } finally {
      await inst.cleanup();
    }
  });
});

describe("migration 20261028000089: delivery_attempts.channel accepts whatsapp", () => {
  // delivery_attempts has no PostgREST insert policy (service-role/job-runner
  // writes only, per rulings "no new tables/policies"), so this mirrors the
  // existing direct-sql insert pattern (tests/db/notifications.test.ts).
  it("a whatsapp delivery_attempts row can be inserted", async () => {
    const inst = await createTestInstitution("delivery-whatsapp");
    try {
      const [notification] = await sql`
        insert into public.notifications (institution_id, recipient_user_id, type, title, body, data)
        values (${inst.institutionId}, ${inst.users.guardian.id}, 'announcement', 'Title', 'Body', '{}'::jsonb)
        returning id
      `;
      const [row] = await sql`
        insert into public.delivery_attempts (institution_id, notification_id, channel, status, rendered_body)
        values (${inst.institutionId}, ${notification.id}, 'whatsapp', 'simulated', 'body')
        returning id
      `;
      expect(row.id).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });
});

describe("app.module_catalog: whatsapp key (0089)", () => {
  it("app.module_enabled is true for empty settings, false when disabled in settings.modules", async () => {
    const bareId = await createBareInstitution({});
    const [{ enabled: defaultEnabled }] = await sql`select app.module_enabled(${bareId}::uuid, 'whatsapp') as enabled`;
    expect(defaultEnabled).toBe(true);

    const offId = await createBareInstitution({ modules: { whatsapp: false } });
    const [{ enabled: disabled }] = await sql`select app.module_enabled(${offId}::uuid, 'whatsapp') as enabled`;
    expect(disabled).toBe(false);
  });
});
