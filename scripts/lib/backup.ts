import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const DATA_SCHEMAS = ["public", "app", "auth", "storage"] as const;
export const DRILL_PROJECT_ID = "coolschool-drill";
export const DRILL_EXCLUDES =
  "studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta";
export const SHARED_LOCAL_DB_PORT = "54322";

/**
 * Format a date as YYYYMMDDTHHMMSSZ-label.
 * Throws if label is outside ^[a-z0-9-]{1,20}$
 */
export function backupDirName(now: Date, label: string): string {
  if (!/^[a-z0-9-]{1,20}$/.test(label)) {
    throw new Error(`invalid label: must match ^[a-z0-9-]{1,20}$, got ${label}`);
  }

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const minute = String(now.getUTCMinutes()).padStart(2, "0");
  const second = String(now.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}T${hour}${minute}${second}Z-${label}`;
}

/**
 * Quote a PostgreSQL identifier, doubling any internal quotes.
 */
export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Check if hostname is loopback.
 */
export function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "127.0.0.1" || lower === "localhost" || lower === "::1" || lower === "[::1]";
}

/**
 * Redact sensitive parts of text containing a database URL.
 * - Replaces the full URL
 * - Replaces the password (raw and percent-decoded)
 * - Skips bare-password replacement for empty or local default passwords
 */
export function redactDbUrl(text: string, dbUrl: string): string {
  let result = text.replace(dbUrl, "***");

  // Parse the URL to extract password
  try {
    const url = new URL(dbUrl);
    const password = url.password;

    if (password && password !== "postgres") {
      // Replace raw password
      result = result.replace(new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "***");

      // Replace percent-decoded password
      try {
        const decoded = decodeURIComponent(password);
        if (decoded !== password) {
          result = result.replace(
            new RegExp(decoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            "***"
          );
        }
      } catch {
        // If decoding fails, skip
      }
    }
  } catch {
    // If URL parsing fails, still replaced the full URL above
  }

  return result;
}

/**
 * Assert that a restore target is safe.
 * - Throws if unset or unparseable
 * - Throws if port is 54322
 * - Throws if non-loopback without matching allowRemoteHost
 * Error message never contains the URL.
 */
export function assertRestoreTarget(
  dbUrl: string | undefined,
  allowRemoteHost?: string
): URL {
  if (!dbUrl) {
    throw new Error("RESTORE_DB_URL is not set");
  }

  let url: URL;
  try {
    url = new URL(dbUrl);
  } catch {
    throw new Error("RESTORE_DB_URL is not a valid URL");
  }

  // Check port 54322
  if (url.port === "54322" || url.hostname === "127.0.0.1:54322") {
    throw new Error("refusing to restore to shared local database (port 54322)");
  }

  // Check loopback
  if (!isLoopbackHost(url.hostname)) {
    if (!allowRemoteHost || allowRemoteHost !== url.hostname) {
      throw new Error("refusing to restore to non-loopback host without matching RESTORE_ALLOW_REMOTE_HOST");
    }
  }

  return url;
}

/**
 * Transform a Supabase config.toml for the drill stack.
 * - Sets project_id = "coolschool-drill"
 * - Replaces 543NN ports with 553NN
 * - Replaces inspector_port 8083 with 8183
 * - Sets [db.seed] enabled = false (only in that section)
 * - Leaves [api] enabled = true untouched
 */
export function drillConfig(configToml: string): string {
  let result = configToml;

  // Set project_id
  if (!result.includes('project_id = "coolschool-drill"')) {
    result = result.replace(/project_id = "[^"]*"/, `project_id = "coolschool-drill"`);
    if (!result.includes("project_id")) {
      result = "[main]\n" + `project_id = "coolschool-drill"\n` + result;
    }
  }

  // Replace 543NN ports with 553NN globally
  result = result.replace(/port = 543(\d\d)/g, "port = 553$1");

  // Replace inspector_port
  result = result.replace(/inspector_port = 8083/g, "inspector_port = 8183");

  // Set [db.seed] enabled = false (only in that section)
  result = result.replace(
    /(\[db\.seed\])([\s\S]*?)(?=\[|$)/,
    (match, section, content) => {
      return section + content.replace(/enabled = true/, "enabled = false");
    }
  );

  return result;
}

/** Roles every Supabase stack's own bootstrap creates; a role-dump restore must never touch them. */
const RESERVED_ROLE_PATTERN =
  /"(supabase_[a-z0-9_]*|authenticator|anon|authenticated|service_role|pgbouncer|dashboard_user|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker)"/;

/**
 * Drop statements from a `--role-only` dump that target a Supabase-reserved role
 * (every stack's own bootstrap already creates/grants these; replaying them as a
 * non-superuser restore role fails, e.g. 42501 on GRANT ... ON PARAMETER).
 * Returns the filtered SQL plus how many statements were dropped. Never logs statement text.
 */
export function filterReservedRoleStatements(rolesSql: string): { sql: string; skipped: number } {
  const statements = rolesSql.split(";");
  let skipped = 0;
  const kept: string[] = [];

  for (const statement of statements) {
    if (statement.trim() === "") {
      kept.push(statement);
      continue;
    }
    if (RESERVED_ROLE_PATTERN.test(statement)) {
      skipped++;
      continue;
    }
    kept.push(statement);
  }

  return { sql: kept.join(";"), skipped };
}

export interface PolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  permissive: "PERMISSIVE" | "RESTRICTIVE";
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

/**
 * Generate DDL for a PostgreSQL policy row.
 * Quotes identifiers except `public` role.
 * Omits using/with_check clauses when null.
 */
export function policyDdl(row: PolicyRow): string {
  const schema = quoteIdent(row.schemaname);
  const table = quoteIdent(row.tablename);
  const policy = quoteIdent(row.policyname);

  const roleList = row.roles
    .map((r) => (r === "public" ? "public" : quoteIdent(r)))
    .join(", ");

  let ddl = `drop policy if exists ${policy} on ${schema}.${table};\ncreate policy ${policy} on ${schema}.${table} as ${row.permissive} for ${row.cmd} to ${roleList}`;

  if (row.qual) {
    ddl += ` using (${row.qual})`;
  }

  if (row.with_check) {
    ddl += ` with check (${row.with_check})`;
  }

  ddl += ";";
  return ddl;
}

export interface TriggerRow {
  schemaname: string;
  tablename: string;
  triggername: string;
  /** Full `CREATE TRIGGER ...` statement from `pg_get_triggerdef`, no trailing `;`. */
  definition: string;
}

/**
 * Generate DDL for a trigger row restored by a `--role-only`/schema-excluded
 * dump that drops auth/storage-attached triggers (M18 managed.sql gap: only
 * pg_policies was regenerated, not triggers our migrations attach to those
 * managed-schema tables, e.g. `on_auth_user_created` on `auth.users`).
 */
export function triggerDdl(row: TriggerRow): string {
  const schema = quoteIdent(row.schemaname);
  const table = quoteIdent(row.tablename);
  const trigger = quoteIdent(row.triggername);
  return `drop trigger if exists ${trigger} on ${schema}.${table};\n${row.definition};`;
}

/**
 * Compute SHA256 hash of a file (hex).
 */
export function sha256File(path: string): string {
  const content = readFileSync(path);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Check that restored counts match expected ranges.
 * Returns array of mismatch messages: "table: expected X–Y, got Z" or "got missing".
 * If count is within [before, after], it passes.
 */
export function countsMismatch(
  expected: Record<string, [number, number]>,
  actual: Record<string, number>
): string[] {
  const mismatches: string[] = [];

  for (const [table, [before, after]] of Object.entries(expected)) {
    const count = actual[table];

    if (count === undefined) {
      mismatches.push(`${table}: expected ${before}–${after}, got missing`);
    } else if (count < before || count > after) {
      mismatches.push(`${table}: expected ${before}–${after}, got ${count}`);
    }
  }

  return mismatches;
}
