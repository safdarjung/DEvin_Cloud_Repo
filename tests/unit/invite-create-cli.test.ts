import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// F18 §H — scripts/invite-create.ts argument rules. No Supabase env is passed,
// so a run whose arguments are accepted stops at the env check: nothing is inserted.
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/invite-create.ts");
const ENV_REFUSAL = "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set";
const UNBOUND_WARNING = "anyone holding this code can claim any email address";

function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, "--note", "Test School", ...args], {
    env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("invite:create CLI arguments", () => {
  it("refuses a code with neither --email nor --unbound", () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--email");
    expect(result.stderr).not.toContain(ENV_REFUSAL);
  });

  it("refuses --email together with --unbound", () => {
    const result = run(["--email", "owner@school.in", "--unbound"]);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain(ENV_REFUSAL);
  });

  it("refuses an invalid --email", () => {
    const result = run(["--email", "not-an-email"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--email must be a valid email address.");
    expect(result.stderr).not.toContain(ENV_REFUSAL);
  });

  it("accepts a valid --email without the unbound warning", () => {
    const result = run(["--email", "  Owner@School.in "]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(ENV_REFUSAL);
    expect(result.stderr).not.toContain(UNBOUND_WARNING);
  });

  it("accepts --unbound only with a one-line warning", () => {
    const result = run(["--unbound"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(ENV_REFUSAL);
    expect(result.stderr.split("\n").filter((line) => line.includes(UNBOUND_WARNING))).toHaveLength(1);
  });
});
