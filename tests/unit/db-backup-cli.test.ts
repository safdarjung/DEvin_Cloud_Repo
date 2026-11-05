import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/db-backup.ts");

function run(args: string[], env: Record<string, string | undefined>) {
  const childEnv: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: childEnv as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("db-backup CLI", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "db-backup-test-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("exits 1 when SUPABASE_DB_URL is unset, leaving the out dir empty", () => {
    const result = run(["--out", outDir], {});
    expect(result.status).toBe(1);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("exits 1 on an invalid label", () => {
    const result = run(["--out", outDir, "--label", "../x"], {
      SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    expect(result.status).toBe(1);
  });

  it("fails on an unreachable DB without ever echoing the password", () => {
    const result = run(["--out", outDir, "--label", "t2"], {
      SUPABASE_DB_URL: "postgresql://postgres:s3cr3t-pass@127.0.0.1:1/postgres",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("s3cr3t-pass");
    expect(result.stderr).not.toContain("s3cr3t-pass");
  });
});
