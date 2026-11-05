import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/db-restore.ts");

function run(args: string[], env: Record<string, string | undefined>) {
  const childEnv: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: childEnv as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("db-restore CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "db-restore-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 1 when RESTORE_DB_URL is unset", () => {
    const result = run([tmpDir], {});
    expect(result.status).toBe(1);
  });

  it("refuses the shared local database and never echoes the password", () => {
    const result = run([tmpDir], {
      RESTORE_DB_URL: "postgresql://postgres:s3cr3t-pass@127.0.0.1:54322/postgres",
    });
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain("shared local");
    expect(result.stderr + result.stdout).not.toContain("s3cr3t-pass");
  });

  it("refuses a non-loopback host without an allow", () => {
    const result = run([tmpDir], {
      RESTORE_DB_URL: "postgresql://postgres:pw@db.example.invalid:5432/postgres",
    });
    expect(result.status).toBe(1);
  });

  it("refuses a non-loopback host when the allow does not match", () => {
    const result = run([tmpDir], {
      RESTORE_DB_URL: "postgresql://postgres:pw@db.example.invalid:5432/postgres",
      RESTORE_ALLOW_REMOTE_HOST: "other.invalid",
    });
    expect(result.status).toBe(1);
  });

  it("checks the guard before the backup directory (missing dir fails on the dir check, not a connection)", () => {
    const result = run([join(tmpDir, "does-not-exist")], {
      RESTORE_DB_URL: "postgresql://postgres:pw@db.example.invalid:5432/postgres",
      RESTORE_ALLOW_REMOTE_HOST: "db.example.invalid",
    });
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain("missing file");
  });

  it("exits 1 when a file's sha256 differs from the manifest", () => {
    writeFileSync(join(tmpDir, "roles.sql"), "-- roles\n");
    writeFileSync(join(tmpDir, "schema.sql"), "-- schema\n");
    writeFileSync(join(tmpDir, "data.sql"), "-- data\n");
    writeFileSync(join(tmpDir, "managed.sql"), "-- managed\n");
    writeFileSync(
      join(tmpDir, "manifest.json"),
      JSON.stringify({
        counts: {},
        files: [
          { name: "roles.sql", sha256: "0".repeat(64) },
          { name: "schema.sql", sha256: "0".repeat(64) },
          { name: "data.sql", sha256: "0".repeat(64) },
          { name: "managed.sql", sha256: "0".repeat(64) },
        ],
      }),
    );

    const result = run([tmpDir], {
      RESTORE_DB_URL: "postgresql://postgres:pw@db.example.invalid:5432/postgres",
      RESTORE_ALLOW_REMOTE_HOST: "db.example.invalid",
    });
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain("checksum");
  });
});
