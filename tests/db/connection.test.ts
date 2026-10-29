import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

describe("local Supabase connection", () => {
  it("connects with SUPABASE_DB_URL and runs select 1", async () => {
    const dbUrl = process.env.SUPABASE_DB_URL;
    expect(dbUrl).toBeDefined();

    const sql = postgres(dbUrl as string, { max: 1 });
    try {
      const rows = await sql`select 1 as value`;
      expect(rows[0]?.value).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it("never exposes the app schema in config.toml", () => {
    const configPath = path.join(process.cwd(), "supabase", "config.toml");
    const config = fs.readFileSync(configPath, "utf8");
    const schemasLine = config
      .split("\n")
      .find((line) => line.trim().startsWith("schemas = "));

    expect(schemasLine).toBeDefined();
    expect(schemasLine).not.toContain('"app"');
  });
});
