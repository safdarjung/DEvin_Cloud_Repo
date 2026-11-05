// M18-T2 — scripts/db-backup.ts
// CLI: node --env-file-if-exists=.env.local scripts/db-backup.ts [--label <l>] [--out <dir>]
// Dumps SUPABASE_DB_URL (roles, schema, data, managed-schema policies) into
// <out>/<backupDirName> via `supabase db dump`. Read-only on the source DB.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import {
  DATA_SCHEMAS,
  backupDirName,
  isLoopbackHost,
  policyDdl,
  quoteIdent,
  redactDbUrl,
  sha256File,
  triggerDdl,
  type PolicyRow,
  type TriggerRow,
} from "./lib/backup.ts";

interface Manifest {
  label: string;
  startedAt: string;
  finishedAt: string;
  cliVersion: string;
  source: { host: string; port: string; database: string };
  appliedMigrations: string[];
  files: Array<{ name: string; bytes: number; sha256: string; ms: number }>;
  counts: Record<string, [number, number]>;
}

function parseArgs(argv: string[]): { label: string; out: string } {
  let label = "local";
  let out = "backups";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--label") label = argv[++i];
    else if (argv[i] === "--out") out = argv[++i];
  }
  return { label, out };
}

async function tableCounts(
  sql: postgres.Sql,
): Promise<Record<string, number>> {
  const tables = await sql<{ schema: string; name: string }[]>`
    select table_schema as schema, table_name as name
    from information_schema.tables
    where table_schema in ('public', 'app')
      and table_type = 'BASE TABLE'
    union all
    select 'auth' as schema, 'users' as name
    union all
    select 'auth' as schema, 'identities' as name
    union all
    select 'storage' as schema, 'buckets' as name
    union all
    select 'storage' as schema, 'objects' as name
  `;
  const counts: Record<string, number> = {};
  for (const { schema, name } of tables) {
    const key = `${schema}.${name}`;
    const [row] = await sql.unsafe<{ count: number }[]>(
      `select count(*)::int as count from ${quoteIdent(schema)}.${quoteIdent(name)}`,
    );
    counts[key] = row.count;
  }
  return counts;
}

async function main(): Promise<void> {
  const { label, out } = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set");

  const startedAt = new Date();
  const dirName = backupDirName(startedAt, label);
  const dir = join(out, dirName);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const url = new URL(dbUrl);
  const sql = postgres(dbUrl, {
    max: 1,
    ssl: isLoopbackHost(url.hostname) ? false : "require",
  });

  try {
    const beforeCounts = await tableCounts(sql);

    const [migrationsTable] = await sql<{ exists: string | null }[]>`
      select to_regclass('supabase_migrations.schema_migrations') as exists
    `;
    const appliedMigrations = migrationsTable.exists
      ? (
          await sql.unsafe<{ version: string }[]>(
            "select version from supabase_migrations.schema_migrations order by version",
          )
        ).map((r) => r.version)
      : [];

    const policyRows = await sql<PolicyRow[]>`
      select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
      where schemaname in ('auth', 'storage')
      order by schemaname, tablename, policyname
    `;
    // Triggers our migrations attach to managed-schema tables (e.g.
    // `on_auth_user_created` on `auth.users`) are excluded from schema.sql
    // along with the rest of those schemas, so they must be regenerated
    // here, same as the policies above.
    const triggerRows = await sql<TriggerRow[]>`
      select n.nspname as schemaname, c.relname as tablename, t.tgname as triggername,
        pg_get_triggerdef(t.oid) as definition
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('auth', 'storage') and not t.tgisinternal
      order by 1, 2, 3
    `;
    const managedSql = [
      ...policyRows.map((row) => policyDdl(row)),
      ...triggerRows.map((row) => triggerDdl(row)),
    ].join("\n");
    writeFileSync(join(dir, "managed.sql"), managedSql);

    const dataSchemas = DATA_SCHEMAS.join(",");
    const dumps: Array<{ name: string; args: string[] }> = [
      { name: "roles.sql", args: ["--role-only"] },
      { name: "schema.sql", args: [] },
      { name: "data.sql", args: ["--data-only", "-s", dataSchemas] },
    ];

    const dumpTimings = new Map<string, number>();
    for (const { name, args } of dumps) {
      const file = join(dir, name);
      const dumpStartedAt = Date.now();
      try {
        execFileSync(
          "pnpm",
          ["exec", "supabase", "db", "dump", "--db-url", dbUrl, ...args, "-f", file],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (err) {
        const stderr = err && typeof err === "object" && "stderr" in err
          ? String((err as { stderr: Buffer | string }).stderr)
          : String(err);
        console.error(redactDbUrl(stderr, dbUrl));
        process.exit(1);
      }
      dumpTimings.set(name, Date.now() - dumpStartedAt);
    }

    const afterCounts = await tableCounts(sql);
    const counts: Record<string, [number, number]> = {};
    for (const key of new Set([...Object.keys(beforeCounts), ...Object.keys(afterCounts)])) {
      counts[key] = [beforeCounts[key] ?? 0, afterCounts[key] ?? 0];
    }

    const cliVersionOutput = execFileSync("pnpm", ["exec", "supabase", "--version"], {
      encoding: "utf8",
    });
    const cliVersion = cliVersionOutput.split("\n")[0].trim();

    const files: Manifest["files"] = [];
    for (const name of ["roles.sql", "schema.sql", "data.sql", "managed.sql"]) {
      const file = join(dir, name);
      chmodSync(file, 0o600);
      files.push({
        name,
        bytes: statSync(file).size,
        sha256: sha256File(file),
        ms: dumpTimings.get(name) ?? 0,
      });
    }

    const finishedAt = new Date();
    const manifest: Manifest = {
      label,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      cliVersion,
      source: { host: url.hostname, port: url.port, database: url.pathname.slice(1) },
      appliedMigrations,
      files,
      counts,
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    chmodSync(join(dir, "manifest.json"), 0o600);

    for (const f of files) {
      console.log(`${f.name}: ${f.bytes} bytes, ${f.ms}ms`);
    }
    console.log(`backup: ${dir}`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  const dbUrl = process.env.SUPABASE_DB_URL;
  const message = err instanceof Error ? err.message : String(err);
  console.error(dbUrl ? redactDbUrl(message, dbUrl) : message);
  process.exit(1);
});
