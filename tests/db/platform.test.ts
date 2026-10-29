import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
});

async function asUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  });
  return result as T;
}

describe("platform migration (0003)", () => {
  const instId = "00000000-0000-0000-0000-00000000c001";
  const userA = "00000000-0000-0000-0000-00000000c0a1";
  const userB = "00000000-0000-0000-0000-00000000c0b1";

  beforeAll(async () => {
    await sql`
      insert into auth.users (id, email, raw_user_meta_data) values
        (${userA}, 'a@platform.test', ${sql.json({ full_name: "Platform User A" })}),
        (${userB}, 'b@platform.test', ${sql.json({ full_name: "Platform User B" })})
    `;
    await sql`insert into public.institutions (id, slug, name) values (${instId}, 'platform-test', 'Platform Test')`;
    const [staffA] = await sql`
      insert into public.staff (institution_id, employee_no, full_name, designation)
      values (${instId}, 'EMP-A', 'Staff A', 'Owner')
      returning id
    `;
    await sql`
      insert into public.memberships (institution_id, user_id, role, staff_id) values
        (${instId}, ${userA}, 'owner', ${staffA.id})
    `;
  });

  afterAll(async () => {
    await sql`delete from public.notifications where institution_id = ${instId}`;
    await sql`delete from public.jobs where institution_id = ${instId}`;
    await sql.begin(async (tx) => {
      await tx`select set_config('app.allow_reset', 'on', true)`;
      await tx`delete from public.audit_events where institution_id = ${instId}`;
    });
    await sql`delete from public.memberships where institution_id = ${instId}`;
    await sql`delete from public.staff where institution_id = ${instId}`;
    await sql`delete from public.institutions where id = ${instId}`;
    await sql`delete from auth.users where id in (${userA}, ${userB})`;
  });

  it("C-07: UPDATE and DELETE on audit_events raise, even for the service-role connection", async () => {
    const [row] = await sql`
      insert into public.audit_events (institution_id, action, entity_type)
      values (${instId}, 'test.action', 'test_entity')
      returning id
    `;

    await expect(
      sql`update public.audit_events set action = 'tampered' where id = ${row.id}`,
    ).rejects.toThrow(/invalid_state/);

    await expect(sql`delete from public.audit_events where id = ${row.id}`).rejects.toThrow(
      /invalid_state/,
    );
  });

  it("membership status change writes an audit_events row with before/after", async () => {
    await sql`update public.memberships set status = 'invited' where institution_id = ${instId} and user_id = ${userA}`;

    const [event] = await sql`
      select before, after from public.audit_events
      where institution_id = ${instId} and action = 'membership.changed'
      order by created_at desc
      limit 1
    `;

    expect(event.before.status).toBe("active");
    expect(event.after.status).toBe("invited");

    await sql`update public.memberships set status = 'active' where institution_id = ${instId} and user_id = ${userA}`;
  });

  it("C-72: duplicate idempotency_key via app.enqueue_job yields one row", async () => {
    const key = "platform-test-idem-1";
    const [{ id: id1 }] = await sql`select app.enqueue_job(${instId}::uuid, 'test_type', '{}'::jsonb, ${key}) as id`;
    const [{ id: id2 }] = await sql`select app.enqueue_job(${instId}::uuid, 'test_type', '{}'::jsonb, ${key}) as id`;

    expect(id2).toBe(id1);

    const rows = await sql`select id from public.jobs where idempotency_key = ${key}`;
    expect(rows).toHaveLength(1);

    await sql`delete from public.jobs where idempotency_key = ${key}`;
  });

  it("C-70: two concurrent claim_job calls on one queued job return one job and one null", async () => {
    const key = "platform-test-idem-2";
    await sql`select app.enqueue_job(${instId}::uuid, 'test_type', '{}'::jsonb, ${key})`;

    const [a, b] = await Promise.all([
      sql`select * from app.claim_job('worker-a')`,
      sql`select * from app.claim_job('worker-b')`,
    ]);

    const claimedIds = [a[0].id, b[0].id].filter((id) => id !== null);
    expect(claimedIds).toHaveLength(1);

    await sql`delete from public.jobs where idempotency_key = ${key}`;
  });

  it("C-71: complete_job(ok=false) requeues with a later run_after, then goes dead at max_attempts", async () => {
    const key = "platform-test-idem-3";
    await sql`
      insert into public.jobs (institution_id, type, payload, idempotency_key, max_attempts)
      values (${instId}, 'test_type', '{}'::jsonb, ${key}, 2)
    `;

    const [claimed1] = await sql`select * from app.claim_job('worker-c')`;
    expect(claimed1.id).not.toBeNull();

    await sql`select app.complete_job(${claimed1.id}::uuid, false, 'boom')`;
    const afterFirstFailure = await sql`select status, run_after, attempts from public.jobs where idempotency_key = ${key}`;
    expect(afterFirstFailure[0].status).toBe("queued");
    expect(afterFirstFailure[0].attempts).toBe(1);
    expect(new Date(afterFirstFailure[0].run_after).getTime()).toBeGreaterThan(Date.now());

    await sql`update public.jobs set run_after = now() where idempotency_key = ${key}`;
    const [claimed2] = await sql`select * from app.claim_job('worker-c')`;
    expect(claimed2.id).toBe(claimed1.id);

    await sql`select app.complete_job(${claimed2.id}::uuid, false, 'boom again')`;
    const final = await sql`select status from public.jobs where idempotency_key = ${key}`;
    expect(final[0].status).toBe("dead");

    await sql`delete from public.jobs where idempotency_key = ${key}`;
  });

  it("C-30: user A cannot SELECT user B's notifications, and can update only read_at on their own", async () => {
    const [notifA] = await sql`
      insert into public.notifications (institution_id, recipient_user_id, type, title, body)
      values (${instId}, ${userA}, 'test', 'Title A', 'Body A')
      returning id
    `;
    const [notifB] = await sql`
      insert into public.notifications (institution_id, recipient_user_id, type, title, body)
      values (${instId}, ${userB}, 'test', 'Title B', 'Body B')
      returning id
    `;

    const asASeeing = await asUser(userA, (tx) => tx`select id from public.notifications where id = ${notifB.id}`);
    expect(asASeeing).toHaveLength(0);

    const ownUpdate = await asUser(
      userA,
      (tx) => tx`update public.notifications set read_at = now() where id = ${notifA.id}`,
    );
    expect(ownUpdate.count).toBe(1);

    await expect(
      asUser(
        userA,
        (tx) => tx`update public.notifications set title = 'hijacked' where id = ${notifA.id}`,
      ),
    ).rejects.toThrow(/forbidden/);

    await sql`delete from public.notifications where id in (${notifA.id}, ${notifB.id})`;
  });
});
