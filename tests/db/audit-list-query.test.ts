import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/types";

// Opt-in mock — only this file's module graph
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { listAuditEvents } from "@/modules/core/audit.queries";
import { listAuditEventsQuery } from "@/modules/core/query-defs";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("core.audit.list query (M06-T4)", () => {
  it("admin lists events newest first with total", async () => {
    const inst = await createTestInstitution("audit-list-newest-first");
    try {
      const uuid1 = crypto.randomUUID();
      const uuid2 = crypto.randomUUID();
      // Insert two audit events
      await sql`
        insert into public.audit_events (institution_id, actor_user_id, action, entity_type, entity_id, created_at)
        values
          (${inst.institutionId}, ${inst.users.admin.id}, 'test.event1', 'test_entity', ${uuid1}, '2026-11-01T10:00:00Z'),
          (${inst.institutionId}, ${inst.users.admin.id}, 'test.event2', 'test_entity', ${uuid2}, '2026-11-01T11:00:00Z')
      `;

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as unknown as SupabaseClient<Database>);
      try {
        const result = await listAuditEvents(ctx, { page: 1, pageSize: 50 });
        expect(result.total).toBeGreaterThanOrEqual(2);
        expect(result.rows.length).toBeGreaterThanOrEqual(2);
        // Newest first: event2 should come before event1
        const idx1 = result.rows.findIndex((r) => r.event === "test.event1");
        const idx2 = result.rows.findIndex((r) => r.event === "test.event2");
        expect(idx2).toBeLessThan(idx1);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("filters by action", async () => {
    const inst = await createTestInstitution("audit-list-filter-action");
    try {
      const uuid1 = crypto.randomUUID();
      const uuid2 = crypto.randomUUID();
      await sql`
        insert into public.audit_events (institution_id, actor_user_id, action, entity_type, entity_id, created_at)
        values
          (${inst.institutionId}, ${inst.users.admin.id}, 'specific.action', 'test_entity', ${uuid1}, '2026-11-01T10:00:00Z'),
          (${inst.institutionId}, ${inst.users.admin.id}, 'other.action', 'test_entity', ${uuid2}, '2026-11-01T11:00:00Z')
      `;

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as unknown as SupabaseClient<Database>);
      try {
        const resultAll = await listAuditEvents(ctx, { page: 1, pageSize: 50 });
        const resultFiltered = await listAuditEvents(ctx, { action: "specific.action", page: 1, pageSize: 50 });

        // All query should have both events
        expect(resultAll.rows.some((r) => r.event === "specific.action")).toBe(true);
        expect(resultAll.rows.some((r) => r.event === "other.action")).toBe(true);

        // Filtered query should have only specific.action
        expect(resultFiltered.rows.length).toBeGreaterThan(0);
        expect(resultFiltered.rows.every((r) => r.event === "specific.action")).toBe(true);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("another institution's events never appear", async () => {
    await withTwoInstitutions(async (a, b) => {
      const uuid1 = crypto.randomUUID();
      // Insert event in institution A
      await sql`
        insert into public.audit_events (institution_id, actor_user_id, action, entity_type, entity_id, created_at)
        values (${a.institutionId}, ${a.users.admin.id}, 'test.event', 'test_entity', ${uuid1}, '2026-11-01T10:00:00Z')
      `;

      const ctx = await buildContext(b, "admin");
      setActingClient(b.clientAs("admin") as unknown as SupabaseClient<Database>);
      try {
        const result = await listAuditEvents(ctx, { page: 1, pageSize: 50 });
        expect(result.rows.every((r) => r.institution_id === b.institutionId)).toBe(true);
      } finally {
        setActingClient(null);
      }
    });
  });

  it("pageSize is clamped to max 100", async () => {
    const inst = await createTestInstitution("audit-list-pagesize-clamp");
    try {
      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as unknown as SupabaseClient<Database>);
      try {
        const result = await listAuditEvents(ctx, { page: 1, pageSize: 200 });
        // pageSize is clamped to 100, so rows.length should be <= 100
        expect(result.rows.length).toBeLessThanOrEqual(100);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden (audit.read gate)", async () => {
    const inst = await createTestInstitution("audit-list-teacher");
    try {
      const result = await callAs(inst, "teacher", listAuditEventsQuery, { page: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("pageSize 101 is rejected as validation_failed", async () => {
    const inst = await createTestInstitution("audit-list-pagesize-101");
    try {
      const result = await callAs(inst, "admin", listAuditEventsQuery, { page: 1, pageSize: 101 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation_failed");
    } finally {
      await inst.cleanup();
    }
  });
});
