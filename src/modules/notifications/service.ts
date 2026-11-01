// No `server-only` import here and no `@/` value imports (only type-only
// ones, erased by stripping): `pnpm jobs:run` (scripts/jobs-run.ts) loads
// this file transitively under plain Node with no bundler and no
// `react-server` condition — same constraint documented on
// src/modules/jobs/runner.ts. `src/modules/notifications/actions.ts` and
// `queries.ts` (Next-only, never loaded by the job runner) use `server-only`
// instead.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { inApp } from "./channels/inApp.ts";
import { simulatedEmail } from "./channels/simulatedEmail.ts";
import { simulatedSms } from "./channels/simulatedSms.ts";
import type { Channel } from "./channels/types.ts";
import { NOTIFICATION_TEMPLATES, type Lang, type NotificationType, type TemplateDef, type VarsFor } from "./templates.ts";

const CHANNELS: Record<Channel["name"], Channel> = {
  in_app: inApp,
  sms: simulatedSms,
  email: simulatedEmail,
};

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * M06-T3 — rows in `notification_preferences` are opt-out: a missing row
 * means the channel is still on, only an explicit `enabled = false` row
 * for this (user, institution, category) drops it. In-app is never
 * looked up here — the table's own check constraint only allows
 * channel in ('sms', 'email') (0068).
 */
async function disabledChannels(
  admin: SupabaseClient<Database>,
  params: { institutionId: string; userId: string; category: string },
): Promise<Set<Channel["name"]>> {
  const { data, error } = await admin
    .from("notification_preferences")
    .select("channel")
    .eq("institution_id", params.institutionId)
    .eq("user_id", params.userId)
    .eq("category", params.category)
    .eq("enabled", false);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.channel as Channel["name"]));
}

export interface CreateNotificationInput<T extends NotificationType> {
  institutionId: string;
  recipientUserId: string;
  type: T;
  /** The absence record / enquiry / enrolment this notification is about — forms the idempotency key with the recipient. */
  entityId: string;
  vars: VarsFor<T>;
  lang?: Lang;
  /** Contact details for simulated channels, resolved by the handler from current DB rows — never from job payload text. */
  contacts?: { sms?: string | null; email?: string | null };
}

export interface CreateNotificationResult {
  notificationId: string;
  /** false when a notification for this (type, entity, recipient) already existed — the handler did no new work (idempotent rerun). */
  created: boolean;
}

/**
 * Inserts a `delivery_attempts` row for every channel in `channels` that
 * does not already have one for this notification. Fix round 1 (MEDIUM):
 * if the notification insert succeeded on an earlier attempt but a later
 * channel's attempt insert then failed (crash, timeout), a retry must
 * backfill only the missing channels, not skip all of them and not
 * duplicate the ones that already exist.
 */
async function ensureDeliveryAttempts(
  admin: SupabaseClient<Database>,
  params: {
    institutionId: string;
    notificationId: string;
    channels: readonly Channel["name"][];
    body: string;
    contacts?: { sms?: string | null; email?: string | null };
  },
): Promise<void> {
  const { data: existingAttempts, error: existingError } = await admin
    .from("delivery_attempts")
    .select("channel")
    .eq("notification_id", params.notificationId);
  if (existingError) throw existingError;

  const alreadyAttempted = new Set((existingAttempts ?? []).map((a) => a.channel));
  const missing = params.channels.filter((channel) => !alreadyAttempted.has(channel));
  if (missing.length === 0) return;

  const toAddressFor = (channel: Channel["name"]): string | null => {
    if (channel === "sms") return params.contacts?.sms ?? null;
    if (channel === "email") return params.contacts?.email ?? null;
    return null;
  };

  for (const channelName of missing) {
    const channel = CHANNELS[channelName];
    const toAddress = toAddressFor(channelName);
    const result = await channel.send({ toAddress, renderedBody: params.body });

    const { error: attemptError } = await admin.from("delivery_attempts").insert({
      institution_id: params.institutionId,
      notification_id: params.notificationId,
      channel: channelName,
      status: result.status,
      to_address: toAddress,
      rendered_body: params.body,
      provider: result.provider ?? null,
      provider_ref: result.providerRef ?? null,
      error: result.error ?? null,
    });
    if (attemptError) throw attemptError;
  }
}

/**
 * 06 §W5/§3 — creates one notification plus one `delivery_attempts` row per
 * channel for its type. Idempotent on `data.key = <type>:<entityId>:<recipientUserId>`
 * (unique index `notifications_data_key_idx`, 0003): a conflict means this
 * exact notification already exists; the handler then backfills any
 * `delivery_attempts` missing from a prior partial run (see
 * `ensureDeliveryAttempts` above) instead of assuming all channels already
 * ran — a retried job reaches exactly one attempt per channel either way.
 */
export async function createNotification<T extends NotificationType>(
  admin: SupabaseClient<Database>,
  input: CreateNotificationInput<T>,
): Promise<CreateNotificationResult> {
  // Indexing the templates map by a generic `T` collapses the lookup's
  // inferred type to an intersection of every type's shape (a known TS
  // indexed-access limitation), not a union keyed on `T` — the cast below
  // restores the per-type shape; `template.varsSchema.parse` still runs a
  // real runtime check against whatever `input.type` actually is.
  const template = NOTIFICATION_TEMPLATES[input.type] as unknown as TemplateDef<VarsFor<T>>;
  const vars = template.varsSchema.parse(input.vars);
  const lang: Lang = input.lang ?? "en";
  const key = `${input.type}:${input.entityId}:${input.recipientUserId}`;
  const title = template.title(lang);
  const body = template.body(vars, lang);

  const disabled = await disabledChannels(admin, {
    institutionId: input.institutionId,
    userId: input.recipientUserId,
    category: template.category,
  });
  const channels = template.channels.filter((channel) => channel === "in_app" || !disabled.has(channel));

  const { data: inserted, error: insertError } = await admin
    .from("notifications")
    .insert({
      institution_id: input.institutionId,
      recipient_user_id: input.recipientUserId,
      type: input.type,
      title,
      body,
      data: { key },
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code !== POSTGRES_UNIQUE_VIOLATION) throw insertError;

    const { data: existing, error: selectError } = await admin
      .from("notifications")
      .select("id")
      .eq("institution_id", input.institutionId)
      .filter("data->>key", "eq", key)
      .single();
    if (selectError) throw selectError;

    await ensureDeliveryAttempts(admin, {
      institutionId: input.institutionId,
      notificationId: existing.id,
      channels,
      body,
      contacts: input.contacts,
    });

    return { notificationId: existing.id, created: false };
  }

  await ensureDeliveryAttempts(admin, {
    institutionId: input.institutionId,
    notificationId: inserted.id,
    channels,
    body,
    contacts: input.contacts,
  });

  return { notificationId: inserted.id, created: true };
}
