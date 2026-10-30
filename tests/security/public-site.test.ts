import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// C-80 (anon never reads drafts) is proven in tests/db/website-schema.test.ts,
// run by this project too (vitest.config.mts). This file adds the T-042
// review MEDIUM: public notices/events of a site that is not live.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 2 });

let inst: TestInstitution;
let websiteId: string;

beforeAll(async () => {
  inst = await createTestInstitution("public-site");
  const [w] = await sql`insert into public.websites (institution_id, is_live) values (${inst.institutionId}, false) returning id`;
  websiteId = w.id as string;
  await sql`insert into public.notices (institution_id, title, body, is_public, publish_at) values (${inst.institutionId}, 'Public notice', 'Body', true, now() - interval '1 day')`;
  await sql`insert into public.events (institution_id, title, starts_at, is_public) values (${inst.institutionId}, 'Public event', now() + interval '1 day', true)`;
}, 60_000);

afterAll(async () => {
  await inst.cleanup();
  await sql.end();
  await closeRolesHelper();
}, 60_000);

async function anonCounts(): Promise<[number, number]> {
  const anon = inst.clientAsAnon();
  const notices = await anon.from("notices").select("id").eq("institution_id", inst.institutionId);
  const events = await anon.from("events").select("id").eq("institution_id", inst.institutionId);
  expect(notices.error).toBeNull();
  expect(events.error).toBeNull();
  return [notices.data!.length, events.data!.length];
}

describe("C-80: anon reads public notices/events only for a live website", () => {
  it("site not live: anon sees no notices or events", async () => {
    expect(await anonCounts()).toEqual([0, 0]);
  });

  it("site live: anon sees the public notice and event", async () => {
    await sql`update public.websites set is_live = true where id = ${websiteId}`;
    expect(await anonCounts()).toEqual([1, 1]);
  });
});
