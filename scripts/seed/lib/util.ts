import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobRow } from "../../../src/modules/jobs/types.ts";
import { mulberry32, SEED_PRNG_SEED } from "./prng.ts";

const DAY_MS = 86_400_000;

/** Insert-if-missing by `id` (ON CONFLICT DO NOTHING): reruns add nothing and never hit update guards on immutable tables. Returns the ids actually inserted. */
export async function insertOnce<T extends { id: string }>(
  admin: SupabaseClient,
  table: string,
  rows: T[],
  batchSize = 500,
): Promise<string[]> {
  const inserted: string[] = [];
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    const { data, error } = await admin
      .from(table)
      .upsert(chunk as never, { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`insertOnce(${table}) failed at offset ${offset}: ${error.message}`);
    inserted.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
  }
  return inserted;
}

/** Own PRNG per section so new sections never consume (or depend on) the shared `ctx.rng` stream. */
export function sectionRng(name: string): () => number {
  const h = createHash("sha1").update(name).digest().readUInt32BE(0);
  return mulberry32((SEED_PRNG_SEED ^ h) >>> 0);
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** UTC midnight of today (real clock, like school-labs/helpdesk) plus `offsetDays`; stable within a day so same-day reruns write identical values. */
export function dayStart(offsetDays = 0): Date {
  return new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS + offsetDays * DAY_MS);
}
export const isoDay = (offsetDays = 0): string => dayStart(offsetDays).toISOString().slice(0, 10);
export const isoAt = (offsetDays: number, hour: number, minute = 0): string =>
  new Date(dayStart(offsetDays).getTime() + (hour * 60 + minute) * 60_000).toISOString();

/** Runs `fn` in one transaction as an authenticated user, so `app.current_user_id()` / `has_role` see them. */
export async function asUser<T>(sql: ReturnType<typeof postgres>, userId: string, fn: (tx: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    return fn(tx as unknown as ReturnType<typeof postgres>);
  })) as T;
}

/** Minimal JobRow for calling a handler in-process (handlers read only institution_id + payload). */
export function fakeJob(type: string, institutionId: string, payload: Record<string, unknown>, key: string): JobRow {
  const now = new Date().toISOString();
  return {
    id: key,
    institution_id: institutionId,
    type,
    payload,
    idempotency_key: key,
    status: "running",
    attempts: 1,
    max_attempts: 3,
    run_after: now,
    locked_at: now,
    locked_by: "seed",
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

export async function demoUsers(sql: ReturnType<typeof postgres>, institutionId: string): Promise<Record<string, string>> {
  const rows = await sql<{ email: string; user_id: string }[]>`
    select u.email, m.user_id from public.memberships m join auth.users u on u.id = m.user_id
    where m.institution_id = ${institutionId} and m.status = 'active' and u.email like '%@demo.coolskool.test'`;
  return Object.fromEntries(rows.map((r) => [r.email.split("@")[0]!, r.user_id]));
}
