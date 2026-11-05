// M18-T3 — scripts/db-restore.ts
// CLI: node scripts/db-restore.ts <backupDir>
// Loads a backup (made by db-backup.ts) into a fresh target database.
// Target comes only from RESTORE_DB_URL, never SUPABASE_DB_URL.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import {
  assertRestoreTarget,
  isLoopbackHost,
  sha256File,
  countsMismatch,
  filterReservedRoleStatements,
} from "./lib/backup.ts";

const REQUIRED_FILES = ["roles.sql", "schema.sql", "data.sql", "managed.sql"] as const;

interface Manifest {
  counts: Record<string, [number, number]>;
  files: Array<{ name: string; sha256: string }>;
}

function readManifest(backupDir: string): Manifest {
  const manifestPath = join(backupDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("missing file: manifest.json");
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

function checkFiles(backupDir: string, manifest: Manifest): void {
  for (const name of REQUIRED_FILES) {
    const filePath = join(backupDir, name);
    if (!existsSync(filePath)) {
      throw new Error(`missing file: ${name}`);
    }
    const entry = manifest.files.find((f) => f.name === name);
    const actual = sha256File(filePath);
    if (!entry || entry.sha256 !== actual) {
      throw new Error(`checksum mismatch: ${name}`);
    }
  }
}

async function main(): Promise<void> {
  const backupDir = process.argv[2];

  // 1. Guard the target before any connection or filesystem check.
  const url = assertRestoreTarget(process.env.RESTORE_DB_URL, process.env.RESTORE_ALLOW_REMOTE_HOST);

  // 2. Verify the backup directory before connecting anywhere.
  if (!backupDir) {
    throw new Error("usage: node scripts/db-restore.ts <backupDir>");
  }
  const manifest = readManifest(backupDir);
  checkFiles(backupDir, manifest);

  // 3. Connect.
  const sql = postgres(url.toString(), {
    max: 1,
    ssl: isLoopbackHost(url.hostname) ? false : "require",
  });

  const startedAt = Date.now();
  try {
    const [{ count }] = await sql`
      select count(*)::int as count from pg_tables where schemaname = 'public'
    `;
    if (count > 0) {
      throw new Error("target not fresh: public schema already has tables");
    }

    // 4. Load roles, schema, data, managed in one transaction.
    await sql.begin(async (tx) => {
      for (const name of REQUIRED_FILES) {
        const text = readFileSync(join(backupDir, name), "utf8");
        const fileStartedAt = Date.now();
        if (name === "roles.sql") {
          // Every Supabase stack's own bootstrap already creates/grants its reserved
          // roles; replaying them via the non-superuser restore role fails (42501).
          const { sql: filtered, skipped } = filterReservedRoleStatements(text);
          await tx.unsafe(filtered).simple();
          console.log(
            `loaded ${name} in ${Date.now() - fileStartedAt}ms (skipped ${skipped} reserved-role statements)`
          );
        } else {
          await tx.unsafe(text).simple();
          console.log(`loaded ${name} in ${Date.now() - fileStartedAt}ms`);
        }
      }
    });

    // 5. Parity check.
    const actual: Record<string, number> = {};
    for (const table of Object.keys(manifest.counts)) {
      const dot = table.indexOf(".");
      const schema = table.slice(0, dot);
      const tableName = table.slice(dot + 1);
      const [row] = await sql`
        select count(*)::int as count from ${sql(schema)}.${sql(tableName)}
      `;
      actual[table] = row.count;
    }

    const mismatches = countsMismatch(manifest.counts, actual);
    if (mismatches.length > 0) {
      for (const line of mismatches) console.error(line);
      throw new Error("parity check failed");
    }

    console.log(`restore: ok ${Object.keys(manifest.counts).length} tables ${Date.now() - startedAt} ms`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    console.error(`${(err as { code: unknown }).code}: ${(err as { message: unknown }).message}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
