import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// X05-T6 (seed section `notifications`). Reads the already-seeded demo
// tenant — run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-timetable.test.ts); the last test triggers its own reseed
// to check the section adds no rows the second time, mirroring
// tests/db/seed-determinism.test.ts.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const repoRoot = path.resolve(import.meta.dirname, "../..");

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
}

let institutionId: string;
let guardianOneUserId: string;
let guardianTwoUserId: string;

beforeAll(async () => {
  const [inst] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!inst) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = inst.id as string;

  const [g1] = await sql`select user_id from public.memberships where institution_id = ${institutionId} and role = 'guardian' and guardian_id = (
    select id from public.guardians where institution_id = ${institutionId} and phone = '9800000001'
  )`;
  const [g2] = await sql`select user_id from public.memberships where institution_id = ${institutionId} and role = 'guardian' and guardian_id = (
    select id from public.guardians where institution_id = ${institutionId} and phone = '9800000002'
  )`;
  guardianOneUserId = g1.user_id as string;
  guardianTwoUserId = g2.user_id as string;
}, 180_000);

afterAll(async () => {
  await sql.end();
});

async function whatsappAttempts(recipientUserId: string, type: string) {
  return sql`
    select da.status, da.provider, da.rendered_body
    from public.delivery_attempts da
    join public.notifications n on n.id = da.notification_id
    where n.institution_id = ${institutionId}
      and n.recipient_user_id = ${recipientUserId}
      and n.type = ${type}
      and da.channel = 'whatsapp'
  `;
}

describe("X05-T6 seed section notifications", () => {
  it("guardian.one has a simulated whatsapp attempt for the announcement", async () => {
    const rows = await whatsappAttempts(guardianOneUserId, "announcement");
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("simulated");
    expect(rows[0]!.provider).toBe("simulated-whatsapp");
  });

  it("guardian.two opted out: no whatsapp attempt for the announcement, but an sms attempt exists", async () => {
    const rows = await whatsappAttempts(guardianTwoUserId, "announcement");
    expect(rows.length).toBe(0);

    const [preference] = await sql`
      select enabled from public.notification_preferences
      where institution_id = ${institutionId} and user_id = ${guardianTwoUserId}
        and category = 'announcement' and channel = 'whatsapp'
    `;
    expect(preference.enabled).toBe(false);

    const smsRows = await sql`
      select da.status
      from public.delivery_attempts da
      join public.notifications n on n.id = da.notification_id
      where n.institution_id = ${institutionId} and n.recipient_user_id = ${guardianTwoUserId}
        and n.type = 'announcement' and da.channel = 'sms'
    `;
    expect(smsRows.length).toBe(1);
  });

  it("guardian.one has a simulated whatsapp attempt for the Hindi attendance_absence, rendered with the Hindi heading", async () => {
    const rows = await whatsappAttempts(guardianOneUserId, "attendance_absence");
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("simulated");
    expect(rows[0]!.rendered_body).toContain("स्कूल अपडेट");
  });

  it("running the section twice (reseed) adds no extra rows", async () => {
    runDemoReset();

    const announcementRows = await whatsappAttempts(guardianOneUserId, "announcement");
    const absenceRows = await whatsappAttempts(guardianOneUserId, "attendance_absence");
    expect(announcementRows.length).toBe(1);
    expect(absenceRows.length).toBe(1);
  }, 180_000);
});
