// M18-T4 — scripts/db-drill.ts
// CLI: node --env-file-if-exists=.env.local scripts/db-drill.ts [--from <backupDir>] [--skip-tests] [--keep]
// Backs up the shared local DB (unless --from), starts a throwaway Supabase
// stack in backups/.drill (project_id coolschool-drill, ports 553NN), restores
// the backup into it, runs `pnpm test:db` against it, then stops the stack
// and deletes its volumes. The shared stack (54321/54322) is only ever read.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DRILL_EXCLUDES, DRILL_PROJECT_ID, drillConfig, redactDbUrl } from "./lib/backup.ts";

const DRILL_WORKDIR = join("backups", ".drill");
const REPO_CONFIG = join("supabase", "config.toml");

interface Args {
  from?: string;
  skipTests: boolean;
  keep: boolean;
}

interface DrillEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
  SUPABASE_DB_URL: string;
  RESTORE_DB_URL: string;
}

interface DrillRecord {
  startedAt: string;
  source: unknown;
  phases: {
    backupMs?: number;
    startMs: number;
    restoreMs: number;
    testDbMs?: number;
    stopMs: number;
    totalMs: number;
  };
  parity: "ok";
  testDb?: { total: number; passed: number; failed: number; failedFiles: string[] };
}

function parseArgs(argv: string[]): Args {
  const args: Args = { skipTests: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from") args.from = argv[++i];
    else if (argv[i] === "--skip-tests") args.skipTests = true;
    else if (argv[i] === "--keep") args.keep = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

// Secrets that may appear in child output: the source URL (hosted creds when
// the owner runs with .env.production.local) and the drill stack's own URL.
const secretUrls: string[] = [];
function redact(text: string): string {
  return secretUrls.reduce((acc, url) => redactDbUrl(acc, url), text);
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Spawns without a shell; stdout/stderr are piped and, when `echo` is set,
// streamed to our stdout through redact(). `supabase start`/`status` print
// keys, so those run with echo = false and their stdout is never printed.
function run(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; echo: boolean },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (opts.echo) process.stdout.write(redact(chunk.toString()));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (opts.echo) process.stderr.write(redact(chunk.toString()));
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function runOrThrow(
  label: string,
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; echo: boolean },
): Promise<RunResult> {
  const result = await run(cmd, args, opts);
  if (result.code !== 0) {
    if (!opts.echo) process.stderr.write(redact(result.stderr));
    throw new Error(`${label} failed with exit code ${result.code}`);
  }
  return result;
}

function writeDrillWorkdir(): void {
  const repoConfig = readFileSync(REPO_CONFIG, "utf8");
  const repoProjectId = /project_id = "([^"]*)"/.exec(repoConfig)?.[1];
  if (!repoProjectId || repoProjectId === DRILL_PROJECT_ID) {
    throw new Error(`repo project_id must differ from drill project_id ${DRILL_PROJECT_ID}`);
  }
  const drillSupabase = join(DRILL_WORKDIR, "supabase");
  mkdirSync(join(drillSupabase, "migrations"), { recursive: true, mode: 0o700 });
  writeFileSync(join(drillSupabase, "config.toml"), drillConfig(repoConfig), { mode: 0o600 });
}

async function backup(): Promise<string> {
  const { stdout } = await runOrThrow(
    "db-backup",
    "node",
    ["scripts/db-backup.ts", "--label", "drill"],
    { echo: true },
  );
  const dir = /^backup: (.+)$/m.exec(stdout)?.[1];
  if (!dir) throw new Error("db-backup printed no `backup: <dir>` line");
  return dir;
}

async function drillStatus(): Promise<DrillEnv> {
  const { stdout } = await runOrThrow(
    "supabase status",
    "pnpm",
    ["exec", "supabase", "--workdir", DRILL_WORKDIR, "status", "-o", "json"],
    { echo: false },
  );
  const status = JSON.parse(stdout) as Record<string, string | undefined>;
  const pick = (...keys: string[]): string => {
    for (const key of keys) if (status[key]) return status[key];
    throw new Error(`supabase status lacks ${keys.join("/")}`);
  };
  const dbUrl = pick("DB_URL");
  const env: DrillEnv = {
    NEXT_PUBLIC_SUPABASE_URL: pick("API_URL"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pick("PUBLISHABLE_KEY", "ANON_KEY"),
    SUPABASE_SECRET_KEY: pick("SECRET_KEY", "SERVICE_ROLE_KEY"),
    SUPABASE_DB_URL: dbUrl,
    RESTORE_DB_URL: dbUrl,
  };
  for (const value of Object.values(env)) {
    if (/:5432[12]\b/.test(value)) {
      throw new Error("drill status points at the shared stack (54321/54322); aborting");
    }
  }
  return env;
}

function readTestDb(file: string): DrillRecord["testDb"] {
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    testResults: Array<{ name: string; status: string }>;
  };
  return {
    total: json.numTotalTests,
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    failedFiles: json.testResults
      .filter((r) => r.status === "failed")
      .map((r) => relative(process.cwd(), r.name)),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const phases: DrillRecord["phases"] = { startMs: 0, restoreMs: 0, stopMs: 0, totalMs: 0 };
  if (process.env.SUPABASE_DB_URL) secretUrls.push(process.env.SUPABASE_DB_URL);

  // 1. Throwaway workdir.
  writeDrillWorkdir();

  // 2. Backup from the shared/source DB (parent env), unless --from.
  let backupDir = args.from;
  if (!backupDir) {
    const t = Date.now();
    backupDir = await backup();
    phases.backupMs = Date.now() - t;
  }
  if (!existsSync(join(backupDir, "manifest.json"))) {
    throw new Error(`no manifest.json in ${backupDir}`);
  }
  const manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8")) as {
    source: unknown;
  };

  let testDb: DrillRecord["testDb"];
  try {
    // 3. Start the drill stack. stdout prints keys: discarded.
    console.log(`starting drill stack (${DRILL_PROJECT_ID}) in ${DRILL_WORKDIR}`);
    let t = Date.now();
    await runOrThrow(
      "supabase start",
      "pnpm",
      ["exec", "supabase", "--workdir", DRILL_WORKDIR, "start", "-x", DRILL_EXCLUDES],
      { echo: false },
    );
    const drillEnv = await drillStatus();
    secretUrls.push(drillEnv.SUPABASE_DB_URL);
    phases.startMs = Date.now() - t;
    const childEnv = { ...process.env, ...drillEnv };

    // 4. Restore into the drill stack.
    t = Date.now();
    await runOrThrow("db-restore", "node", ["scripts/db-restore.ts", backupDir], {
      env: childEnv,
      echo: true,
    });
    phases.restoreMs = Date.now() - t;

    // 5. test:db against the drill stack.
    if (!args.skipTests) {
      const outputFile = join(backupDir, "testdb.json");
      console.log("running pnpm test:db against the drill stack");
      t = Date.now();
      const result = await run(
        "pnpm",
        [
          "test:db",
          "--reporter=default",
          "--reporter=json",
          `--outputFile.json=${outputFile}`,
        ],
        { env: childEnv, echo: true },
      );
      phases.testDbMs = Date.now() - t;
      if (!existsSync(outputFile)) {
        throw new Error(`test:db wrote no ${outputFile} (exit code ${result.code})`);
      }
      testDb = readTestDb(outputFile);
    }
  } finally {
    // 6. Teardown: only the drill workdir's stack, never the shared one.
    if (args.keep) {
      console.log(`--keep: drill stack left running (stop with: pnpm exec supabase --workdir ${DRILL_WORKDIR} stop --no-backup)`);
    } else {
      const t = Date.now();
      const stop = await run(
        "pnpm",
        ["exec", "supabase", "--workdir", DRILL_WORKDIR, "stop", "--no-backup"],
        { echo: false },
      );
      if (stop.code !== 0) {
        process.stderr.write(redact(stop.stderr));
        console.error(`supabase stop failed with exit code ${stop.code}`);
      }
      phases.stopMs = Date.now() - t;
    }
  }

  // 7. Record (reached only when restore + parity succeeded).
  phases.totalMs = Date.now() - startedAt.getTime();
  const record: DrillRecord = {
    startedAt: startedAt.toISOString(),
    source: manifest.source,
    phases,
    parity: "ok",
    ...(testDb ? { testDb } : {}),
  };
  writeFileSync(join(backupDir, "drill.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
  for (const [phase, ms] of Object.entries(record.phases)) console.log(`${phase}: ${ms} ms`);
  if (record.testDb) {
    const { total, passed, failed, failedFiles } = record.testDb;
    console.log(`test:db: ${passed}/${total} passed, ${failed} failed`);
    for (const file of failedFiles) console.log(`  failed: ${file}`);
  }
  console.log(`drill: ok ${backupDir}`);
}

main().catch((err: unknown) => {
  console.error(redact(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
