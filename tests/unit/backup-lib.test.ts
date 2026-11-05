import { describe, it, expect, beforeEach } from "vitest";
import {
  DATA_SCHEMAS,
  DRILL_PROJECT_ID,
  DRILL_EXCLUDES,
  SHARED_LOCAL_DB_PORT,
  backupDirName,
  quoteIdent,
  isLoopbackHost,
  redactDbUrl,
  assertRestoreTarget,
  drillConfig,
  policyDdl,
  triggerDdl,
  countsMismatch,
  filterReservedRoleStatements,
} from "../../scripts/lib/backup";

describe("backup lib", () => {
  describe("constants", () => {
    it("exports correct DATA_SCHEMAS", () => {
      expect(DATA_SCHEMAS).toEqual(["public", "app", "auth", "storage"]);
    });

    it("exports correct DRILL_PROJECT_ID", () => {
      expect(DRILL_PROJECT_ID).toBe("coolschool-drill");
    });

    it("exports correct DRILL_EXCLUDES", () => {
      expect(DRILL_EXCLUDES).toBe("studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta");
    });

    it("exports correct SHARED_LOCAL_DB_PORT", () => {
      expect(SHARED_LOCAL_DB_PORT).toBe("54322");
    });
  });

  describe("backupDirName", () => {
    it("formats date as YYYYMMDDTHHMMSSZ-label", () => {
      const date = new Date("2026-11-02T09:30:05.123Z");
      const result = backupDirName(date, "local");
      expect(result).toBe("20261102T093005Z-local");
    });

    it("throws on label outside ^[a-z0-9-]{1,20}$", () => {
      const date = new Date();
      expect(() => backupDirName(date, "../x")).toThrow();
      expect(() => backupDirName(date, "UPPERCASE")).toThrow();
      expect(() => backupDirName(date, "a_b")).toThrow();
      expect(() => backupDirName(date, "a".repeat(21))).toThrow();
    });

    it("accepts valid labels", () => {
      const date = new Date();
      expect(() => backupDirName(date, "local")).not.toThrow();
      expect(() => backupDirName(date, "hosted")).not.toThrow();
      expect(() => backupDirName(date, "test-123")).not.toThrow();
      expect(() => backupDirName(date, "a")).not.toThrow();
    });
  });

  describe("quoteIdent", () => {
    it("quotes identifiers and doubles internal quotes", () => {
      expect(quoteIdent("simple")).toBe('"simple"');
      expect(quoteIdent('has"quote')).toBe('"has""quote"');
      expect(quoteIdent('two"quotes"here')).toBe('"two""quotes""here"');
    });
  });

  describe("isLoopbackHost", () => {
    it("returns true for loopback hosts", () => {
      expect(isLoopbackHost("127.0.0.1")).toBe(true);
      expect(isLoopbackHost("localhost")).toBe(true);
      expect(isLoopbackHost("::1")).toBe(true);
      expect(isLoopbackHost("[::1]")).toBe(true);
    });

    it("returns false for remote hosts", () => {
      expect(isLoopbackHost("example.com")).toBe(false);
      expect(isLoopbackHost("192.168.1.1")).toBe(false);
      expect(isLoopbackHost("db.example.invalid")).toBe(false);
    });
  });

  describe("redactDbUrl", () => {
    it("redacts hosted URL with percent-encoded password", () => {
      const text = "postgresql://postgres:my%40pass@db.example.com/postgres";
      const url = "postgresql://postgres:my%40pass@db.example.com/postgres";
      const result = redactDbUrl(text, url);
      expect(result).toContain("***");
      expect(result).not.toContain("my%40pass");
      expect(result).not.toContain("my@pass");
    });

    it("redacts password both raw and percent-decoded forms", () => {
      const text = "password is s3cr3t-pass or s3cr3t%2Dpass in the URL";
      const url = "postgresql://user:s3cr3t-pass@localhost/db";
      const result = redactDbUrl(text, url);
      expect(result).not.toContain("s3cr3t-pass");
    });

    it("does not redact bare word 'postgres' for local URLs", () => {
      const text = "user postgres connected successfully";
      const url = "postgresql://postgres:postgres@127.0.0.1/postgres";
      const result = redactDbUrl(text, url);
      expect(result).toContain("postgres");
    });

    it("replaces full URL", () => {
      const text = "Connecting to postgresql://user:pass@example.com/db";
      const url = "postgresql://user:pass@example.com/db";
      const result = redactDbUrl(text, url);
      expect(result).not.toContain("example.com");
      expect(result).toContain("***");
    });
  });

  describe("assertRestoreTarget", () => {
    it("throws when RESTORE_DB_URL is unset", () => {
      expect(() => assertRestoreTarget(undefined)).toThrow();
    });

    it("throws when URL is unparseable", () => {
      expect(() => assertRestoreTarget("not a url")).toThrow();
    });

    it("throws when port is 54322 (shared local DB)", () => {
      expect(() => assertRestoreTarget("postgresql://localhost:54322/postgres")).toThrow();
    });

    it("throws for non-loopback host without allow", () => {
      expect(() => assertRestoreTarget("postgresql://db.example.invalid/postgres")).toThrow();
    });

    it("does not mention URL in error messages", () => {
      try {
        assertRestoreTarget("postgresql://postgres:secret@db.example.invalid/postgres");
        expect.fail("should have thrown");
      } catch (error) {
        expect((error as Error).message).not.toContain("db.example.invalid");
        expect((error as Error).message).not.toContain("secret");
      }
    });

    it("passes for loopback host with non-reserved port", () => {
      const result = assertRestoreTarget("postgresql://127.0.0.1:55322/postgres");
      expect(result).toBeInstanceOf(URL);
      expect(result.hostname).toBe("127.0.0.1");
    });

    it("passes for localhost", () => {
      const result = assertRestoreTarget("postgresql://localhost/postgres");
      expect(result).toBeInstanceOf(URL);
    });

    it("passes for remote host with matching RESTORE_ALLOW_REMOTE_HOST", () => {
      const url = "postgresql://db.example.invalid/postgres";
      const result = assertRestoreTarget(url, "db.example.invalid");
      expect(result.hostname).toBe("db.example.invalid");
    });

    it("throws when RESTORE_ALLOW_REMOTE_HOST does not match", () => {
      expect(() =>
        assertRestoreTarget("postgresql://db.example.invalid/postgres", "other.invalid")
      ).toThrow();
    });
  });

  describe("drillConfig", () => {
    let baseConfig: string;

    beforeEach(() => {
      baseConfig = `[db]
enabled = true
port = 54322
[db.seed]
enabled = true
[api]
enabled = true
port = 54321
[studio]
enabled = true`;
    });

    it("replaces project_id with coolschool-drill", () => {
      const result = drillConfig(baseConfig);
      expect(result).toContain('project_id = "coolschool-drill"');
    });

    it("replaces 543NN ports with 553NN", () => {
      const result = drillConfig(baseConfig);
      expect(result).not.toContain("port = 54322");
      expect(result).not.toContain("port = 54321");
      expect(result).toContain("port = 55322");
      expect(result).toContain("port = 55321");
    });

    it("replaces inspector_port 8083 with 8183", () => {
      const config = baseConfig + "\ninspector_port = 8083";
      const result = drillConfig(config);
      expect(result).toContain("inspector_port = 8183");
    });

    it("sets [db.seed] enabled = false", () => {
      const result = drillConfig(baseConfig);
      expect(result).toContain("[db.seed]");
      // More precise check: [db.seed] section must contain "enabled = false"
      const dbSeedMatch = result.match(/\[db\.seed\]([\s\S]*?)(?=\[|$)/);
      expect(dbSeedMatch?.[1]).toContain("enabled = false");
    });

    it("leaves [api] enabled = true untouched", () => {
      const result = drillConfig(baseConfig);
      const apiMatch = result.match(/\[api\][\s\S]*?(?=\[|$)/);
      expect(apiMatch?.[0]).toContain("enabled = true");
    });
  });

  describe("policyDdl", () => {
    it("quotes identifiers", () => {
      const row = {
        schemaname: "public",
        tablename: "students",
        policyname: "student_select",
        permissive: "PERMISSIVE" as const,
        roles: ["authenticated"],
        cmd: "SELECT",
        qual: "institution_id = auth.uid()",
        with_check: null,
      };
      const result = policyDdl(row);
      expect(result).toContain('"public"');
      expect(result).toContain('"students"');
      expect(result).toContain('"student_select"');
    });

    it("leaves public role unquoted", () => {
      const row = {
        schemaname: "public",
        tablename: "students",
        policyname: "student_select",
        permissive: "PERMISSIVE" as const,
        roles: ["public"],
        cmd: "SELECT",
        qual: "true",
        with_check: null,
      };
      const result = policyDdl(row);
      expect(result).toContain("to public");
      expect(result).not.toContain('"public" using');
    });

    it("omits using clause when qual is null", () => {
      const row = {
        schemaname: "public",
        tablename: "students",
        policyname: "student_select",
        permissive: "PERMISSIVE" as const,
        roles: ["authenticated"],
        cmd: "SELECT",
        qual: null,
        with_check: null,
      };
      const result = policyDdl(row);
      expect(result).not.toContain("using");
    });

    it("omits with check clause when null", () => {
      const row = {
        schemaname: "public",
        tablename: "students",
        policyname: "student_select",
        permissive: "PERMISSIVE" as const,
        roles: ["authenticated"],
        cmd: "UPDATE",
        qual: "institution_id = auth.uid()",
        with_check: null,
      };
      const result = policyDdl(row);
      expect(result).not.toContain("with check");
    });

    it("includes both clauses when both present", () => {
      const row = {
        schemaname: "public",
        tablename: "students",
        policyname: "student_update",
        permissive: "PERMISSIVE" as const,
        roles: ["authenticated"],
        cmd: "UPDATE",
        qual: "institution_id = auth.uid()",
        with_check: "institution_id = auth.uid()",
      };
      const result = policyDdl(row);
      expect(result).toContain("using");
      expect(result).toContain("with check");
    });
  });

  describe("triggerDdl", () => {
    it("quotes identifiers and drops before creating", () => {
      const row = {
        schemaname: "auth",
        tablename: "users",
        triggername: "on_auth_user_created",
        definition:
          'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION app.handle_new_auth_user()',
      };
      const result = triggerDdl(row);
      expect(result).toContain('drop trigger if exists "on_auth_user_created" on "auth"."users";');
      expect(result.indexOf("drop trigger")).toBeLessThan(result.indexOf("CREATE TRIGGER"));
      expect(result).toContain("CREATE TRIGGER on_auth_user_created");
      expect(result.trim().endsWith(";")).toBe(true);
    });
  });

  describe("filterReservedRoleStatements", () => {
    const rolesSql = `SET default_transaction_read_only = off;

ALTER ROLE "anon" SET "statement_timeout" TO '3s';

GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";

CREATE ROLE "app_custom" LOGIN;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO "app_custom";

RESET ALL;
`;

    it("drops the exact failing line (GRANT ON PARAMETER to a supabase_ role)", () => {
      const { sql, skipped } = filterReservedRoleStatements(rolesSql);
      expect(sql).not.toContain("log_min_messages");
      expect(sql).not.toContain("supabase_realtime_admin");
      expect(skipped).toBeGreaterThan(0);
    });

    it("keeps a custom-role CREATE/GRANT", () => {
      const { sql } = filterReservedRoleStatements(rolesSql);
      expect(sql).toContain('CREATE ROLE "app_custom" LOGIN');
      expect(sql).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA public TO "app_custom"');
    });

    it("drops every reserved-role statement and counts them", () => {
      const { sql, skipped } = filterReservedRoleStatements(rolesSql);
      expect(sql).not.toContain('"anon"');
      expect(skipped).toBe(2);
    });

    it("leaves non-role-targeting statements untouched", () => {
      const { sql } = filterReservedRoleStatements(rolesSql);
      expect(sql).toContain("SET default_transaction_read_only = off");
      expect(sql).toContain("RESET ALL");
    });

    it("drops statements targeting any supabase_-prefixed role", () => {
      const { sql, skipped } = filterReservedRoleStatements(
        `CREATE ROLE "supabase_storage_admin";\nCREATE ROLE "app_viewer";\n`
      );
      expect(sql).not.toContain("supabase_storage_admin");
      expect(sql).toContain('"app_viewer"');
      expect(skipped).toBe(1);
    });

    it("returns skipped 0 and unchanged sql when nothing matches", () => {
      const clean = 'CREATE ROLE "app_viewer";\n';
      const { sql, skipped } = filterReservedRoleStatements(clean);
      expect(skipped).toBe(0);
      expect(sql).toContain('"app_viewer"');
    });
  });

  describe("countsMismatch", () => {
    it("flags out-of-range table", () => {
      const expected: Record<string, [number, number]> = {
        "public.students": [252, 252],
        "public.staff": [10, 10],
      };
      const actual = { "public.students": 300, "public.staff": 10 };
      const result = countsMismatch(expected, actual);
      expect(result).toContainEqual(expect.stringContaining("public.students"));
      expect(result).not.toContainEqual(expect.stringContaining("public.staff"));
    });

    it("flags missing table", () => {
      const expected: Record<string, [number, number]> = { "public.students": [100, 100] };
      const actual = {};
      const result = countsMismatch(expected, actual);
      expect(result.length).toBe(1);
      expect(result[0]).toContain("got missing");
    });

    it("passes table within [before, after] range", () => {
      const expected: Record<string, [number, number]> = { "public.students": [250, 260] };
      const actual = { "public.students": 255 };
      const result = countsMismatch(expected, actual);
      expect(result).toHaveLength(0);
    });

    it("flags multiple mismatches", () => {
      const expected: Record<string, [number, number]> = {
        "public.students": [100, 100],
        "public.staff": [10, 15],
        "auth.users": [50, 50],
      };
      const actual = { "public.students": 200, "public.staff": 20, "auth.users": 50 };
      const result = countsMismatch(expected, actual);
      expect(result.length).toBe(2);
      expect(result).toContainEqual(expect.stringContaining("public.students"));
      expect(result).toContainEqual(expect.stringContaining("public.staff"));
    });
  });
});
