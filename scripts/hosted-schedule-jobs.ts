// T-044 — schedules the job runner on the hosted project with pg_cron + pg_net
// (free on every Supabase plan) instead of Vercel Cron (Hobby runs cron only
// daily). Idempotent. CRON_SECRET goes into Supabase Vault, never the repo.
// Run: node --env-file=.env.production.local scripts/hosted-schedule-jobs.ts
import postgres from "postgres";

const { SUPABASE_DB_URL, CRON_SECRET, APP_URL } = process.env;
if (!SUPABASE_DB_URL || !CRON_SECRET || !APP_URL) {
  throw new Error("SUPABASE_DB_URL, CRON_SECRET and APP_URL are required.");
}
if (!APP_URL.startsWith("https://")) throw new Error("APP_URL must be https.");

const JOB_NAME = "coolskool-jobs-run";
const SECRET_NAME = "coolskool_cron_secret";
const sql = postgres(SUPABASE_DB_URL, { max: 1, ssl: "require" });

try {
  await sql`create extension if not exists pg_cron with schema pg_catalog`;
  await sql`create extension if not exists pg_net with schema extensions`;

  const [existing] = await sql`select id from vault.secrets where name = ${SECRET_NAME}`;
  if (existing) await sql`select vault.update_secret(${existing.id}::uuid, ${CRON_SECRET})`;
  else await sql`select vault.create_secret(${CRON_SECRET}, ${SECRET_NAME})`;

  await sql`select cron.unschedule(jobid) from cron.job where jobname = ${JOB_NAME}`;
  // The command reads the secret from Vault at run time; only the URL is inlined.
  const command = `
    select net.http_post(
      url := ${quote(`${APP_URL}/api/jobs/run`)},
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = ${quote(SECRET_NAME)})
      ),
      body := '{}'::jsonb
    )`;
  await sql`select cron.schedule(${JOB_NAME}, '*/5 * * * *', ${command})`;

  const [job] = await sql`select jobname, schedule, active from cron.job where jobname = ${JOB_NAME}`;
  console.log(`Scheduled ${job.jobname} (${job.schedule}, active=${job.active}).`);
} finally {
  await sql.end();
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
