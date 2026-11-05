// X05-T4 — notification.preferences.set accepts channel "whatsapp"
// (PREFERENCE_CHANNELS: 0068 + 0089) and is gated by the "whatsapp" module
// only when the caller asks for that channel; other channels are unaffected.
// listDeliveryLog's DeliveryLogRow.channel union also carries "whatsapp".
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/types";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import { setNotificationPreference } from "@/modules/notifications/announcements.actions";
import { listDeliveryLog } from "@/modules/notifications/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function disableWhatsapp(institutionId: string): Promise<void> {
  await sql`
    update public.institutions set settings = jsonb_set(settings, '{modules,whatsapp}', 'false')
    where id = ${institutionId}
  `;
}

describe("notification.preferences.set channel whatsapp (X05-T4)", () => {
  it("a guardian sets a whatsapp preference -> ok, row stored, audit carries no phone", async () => {
    const inst = await createTestInstitution("whatsapp-pref-ok");
    try {
      const result = await callAs(inst, "guardian", setNotificationPreference, {
        category: "announcement",
        channel: "whatsapp",
        enabled: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({ category: "announcement", channel: "whatsapp", enabled: false });

      const [row] = await sql`
        select enabled from public.notification_preferences
        where user_id = ${inst.users.guardian.id} and institution_id = ${inst.institutionId}
          and category = 'announcement' and channel = 'whatsapp'
      `;
      expect(row.enabled).toBe(false);

      const [guardianPhone] = await sql`
        select g.phone from public.guardians g
        join public.memberships m on m.guardian_id = g.id
        where m.user_id = ${inst.users.guardian.id} and m.institution_id = ${inst.institutionId}
      `;
      const [event] = await sql`
        select after from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'notification.preference_set'
        order by created_at desc limit 1
      `;
      expect(event.after).toEqual({ category: "announcement", channel: "whatsapp", enabled: false });
      expect(JSON.stringify(event.after)).not.toContain(guardianPhone?.phone ?? "\u0000no-phone\u0000");
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("whatsapp module off -> forbidden, exact MODULE_DISABLED_MESSAGE, no row written", async () => {
    const inst = await createTestInstitution("whatsapp-pref-off");
    try {
      await disableWhatsapp(inst.institutionId);

      const result = await callAs(inst, "guardian", setNotificationPreference, {
        category: "announcement",
        channel: "whatsapp",
        enabled: false,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ code: "forbidden", message: MODULE_DISABLED_MESSAGE });

      const rows = await sql`
        select 1 from public.notification_preferences
        where user_id = ${inst.users.guardian.id} and institution_id = ${inst.institutionId}
          and category = 'announcement' and channel = 'whatsapp'
      `;
      expect(rows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("whatsapp module off does not block an sms preference", async () => {
    const inst = await createTestInstitution("whatsapp-pref-off-sms-ok");
    try {
      await disableWhatsapp(inst.institutionId);

      const result = await callAs(inst, "guardian", setNotificationPreference, {
        category: "announcement",
        channel: "sms",
        enabled: false,
      });
      expect(result.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("an unknown channel is rejected by validation, not reached as whatsapp", async () => {
    const inst = await createTestInstitution("whatsapp-pref-bad-channel");
    try {
      const result = await callAs(inst, "guardian", setNotificationPreference, {
        category: "announcement",
        channel: "telegram" as never,
        enabled: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation_failed");
    } finally {
      await inst.cleanup();
    }
  }, 20000);
});

describe("notifications.listDeliveryLog channel whatsapp (X05-T4)", () => {
  it("admin's delivery log returns a whatsapp row typed through", async () => {
    const inst = await createTestInstitution("whatsapp-pref-log");
    try {
      const [notification] = await sql`
        insert into public.notifications (institution_id, recipient_user_id, type, title, body, data)
        values (${inst.institutionId}, ${inst.users.guardian.id}, 'announcement', 'Title', 'Body', '{}'::jsonb)
        returning id
      `;
      await sql`
        insert into public.delivery_attempts (institution_id, notification_id, channel, status, rendered_body)
        values (${inst.institutionId}, ${notification.id}, 'whatsapp', 'simulated', 'School update body')
      `;

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as unknown as SupabaseClient<Database>);
      let rows;
      try {
        rows = await listDeliveryLog(ctx);
      } finally {
        setActingClient(null);
      }
      const whatsappRow = rows.find((r) => r.notificationId === notification.id);
      expect(whatsappRow).toMatchObject({ channel: "whatsapp", status: "simulated" });
    } finally {
      await inst.cleanup();
    }
  }, 20000);
});
