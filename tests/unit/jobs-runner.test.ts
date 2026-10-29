import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createRunnerPorts,
  runOnceCore,
  sanitizeLastError,
  UnknownJobTypeError,
  type RunnerPorts,
} from "@/modules/jobs/runner";
import { resolveHandler } from "@/modules/jobs/registry";
import type { JobRow } from "@/modules/jobs/types";
import type { Database } from "@/lib/db/types";

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    institution_id: "inst-1",
    type: "notify.attendance_absence",
    payload: {},
    idempotency_key: "key-1",
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_after: now,
    locked_at: now,
    locked_by: "worker-1",
    last_error: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function fakePorts(overrides: Partial<RunnerPorts> = {}): RunnerPorts {
  return {
    claimJob: vi.fn(async () => null),
    completeJob: vi.fn(async () => {}),
    killUnknown: vi.fn(async () => {}),
    dispatch: vi.fn(async () => {}),
    now: () => 0,
    ...overrides,
  };
}

describe("runOnceCore (dispatch/backoff/budget logic — DB-level claim concurrency is tests/db/jobs.test.ts)", () => {
  it("claims nothing and returns zero counts when the queue is empty", async () => {
    const ports = fakePorts();
    const summary = await runOnceCore({ workerId: "w1" }, ports);
    expect(summary).toEqual({ claimed: 0, succeeded: 0, requeued: 0, dead: 0 });
    expect(ports.claimJob).toHaveBeenCalledTimes(1);
  });

  it("marks a job succeeded when the handler resolves", async () => {
    const job = makeJob();
    const claimJob = vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    const completeJob = vi.fn(async () => {});
    const ports = fakePorts({ claimJob, completeJob });

    const summary = await runOnceCore({ workerId: "w1" }, ports);

    expect(summary).toEqual({ claimed: 1, succeeded: 1, requeued: 0, dead: 0 });
    expect(completeJob).toHaveBeenCalledWith(job.id, true);
  });

  it("dead-letters an unknown type immediately (no retry), without calling completeJob", async () => {
    const job = makeJob({ type: "bogus.type", attempts: 1, max_attempts: 5 });
    const claimJob = vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    const completeJob = vi.fn(async () => {});
    const killUnknown = vi.fn(async () => {});
    const dispatch = vi.fn(async () => {
      throw new UnknownJobTypeError(job.type);
    });
    const ports = fakePorts({ claimJob, completeJob, killUnknown, dispatch });

    const summary = await runOnceCore({ workerId: "w1" }, ports);

    expect(summary).toEqual({ claimed: 1, succeeded: 0, requeued: 0, dead: 1 });
    expect(killUnknown).toHaveBeenCalledWith(job.id, "unknown_type");
    expect(completeJob).not.toHaveBeenCalled();
  });

  it("requeues a failed job below max_attempts (C-71)", async () => {
    const job = makeJob({ attempts: 2, max_attempts: 5 });
    const claimJob = vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    const completeJob = vi.fn(async () => {});
    const dispatch = vi.fn(async () => {
      throw new Error("boom");
    });
    const ports = fakePorts({ claimJob, completeJob, dispatch });

    const summary = await runOnceCore({ workerId: "w1" }, ports);

    expect(summary).toEqual({ claimed: 1, succeeded: 0, requeued: 1, dead: 0 });
    expect(completeJob).toHaveBeenCalledWith(job.id, false, "boom");
  });

  it("counts a job dead once attempts has reached max_attempts (C-71)", async () => {
    const job = makeJob({ attempts: 5, max_attempts: 5 });
    const claimJob = vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    const completeJob = vi.fn(async () => {});
    const dispatch = vi.fn(async () => {
      throw new Error("boom");
    });
    const ports = fakePorts({ claimJob, completeJob, dispatch });

    const summary = await runOnceCore({ workerId: "w1" }, ports);

    expect(summary).toEqual({ claimed: 1, succeeded: 0, requeued: 0, dead: 1 });
    expect(completeJob).toHaveBeenCalledWith(job.id, false, "boom");
  });

  it("stops at the time budget without claiming further jobs", async () => {
    let time = 0;
    const claimJob = vi.fn(async () => {
      time += 1000;
      return makeJob({ id: `job-${time}` });
    });
    const ports = fakePorts({ claimJob, now: () => time });

    const summary = await runOnceCore({ workerId: "w1", budgetMs: 1500, max: 50 }, ports);

    // now()=0 < 1500 -> claim #1 (time=1000); 1000 < 1500 -> claim #2 (time=2000);
    // 2000 < 1500 is false -> stop.
    expect(summary.claimed).toBe(2);
  });

  it("stops at `max` without claiming further jobs even when the queue has more", async () => {
    const claimJob = vi.fn(async () => makeJob({ id: crypto.randomUUID() }));
    const ports = fakePorts({ claimJob });

    const summary = await runOnceCore({ workerId: "w1", max: 3 }, ports);

    expect(summary.claimed).toBe(3);
    expect(claimJob).toHaveBeenCalledTimes(3);
  });
});

// Minimal fake of the one supabase-js surface `createRunnerPorts` touches:
// `.rpc(fn, args)` for the jobs_claim/jobs_complete wrappers (20261028000012)
// and `.from('jobs').update(...).eq('id', id)` for the unknown-type kill
// path. No real Postgres connection anywhere in this module (lead rework:
// the web route must use the service role, never a superuser DSN).
function fakeAdmin(opts: {
  rpcResult?: { data: unknown; error: { message: string } | null };
  updateError?: { message: string } | null;
} = {}): { admin: SupabaseClient<Database>; rpc: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(async () => opts.rpcResult ?? { data: null, error: null });
  const eq = vi.fn(async () => ({ error: opts.updateError ?? null }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const admin = { rpc, from } as unknown as SupabaseClient<Database>;
  return { admin, rpc, update };
}

describe("createRunnerPorts (jobs_claim/jobs_complete RPC wrappers + direct jobs UPDATE)", () => {
  it("claimJob calls the jobs_claim RPC and parses a returned row", async () => {
    const job = makeJob({ id: "job-rpc-1" });
    const { admin, rpc } = fakeAdmin({ rpcResult: { data: job, error: null } });
    const ports = createRunnerPorts(admin);

    const claimed = await ports.claimJob("worker-1");

    expect(rpc).toHaveBeenCalledWith("jobs_claim", { p_worker_id: "worker-1" });
    expect(claimed?.id).toBe("job-rpc-1");
  });

  it("claimJob returns null when jobs_claim finds nothing", async () => {
    const { admin } = fakeAdmin({ rpcResult: { data: null, error: null } });
    const ports = createRunnerPorts(admin);

    expect(await ports.claimJob("worker-1")).toBeNull();
  });

  it("claimJob throws on an RPC error", async () => {
    const { admin } = fakeAdmin({ rpcResult: { data: null, error: { message: "boom" } } });
    const ports = createRunnerPorts(admin);

    await expect(ports.claimJob("worker-1")).rejects.toThrow("boom");
  });

  it("completeJob calls the jobs_complete RPC with the right args", async () => {
    const { admin, rpc } = fakeAdmin();
    const ports = createRunnerPorts(admin);

    await ports.completeJob("job-1", false, "boom");

    expect(rpc).toHaveBeenCalledWith("jobs_complete", { p_id: "job-1", p_ok: false, p_error: "boom" });
  });

  it("killUnknown updates public.jobs directly (no app.complete_job, no retry)", async () => {
    const { admin, update } = fakeAdmin();
    const ports = createRunnerPorts(admin);

    await ports.killUnknown("job-1", "unknown_type");

    expect(update).toHaveBeenCalledWith({
      status: "dead",
      last_error: "unknown_type",
      locked_at: null,
      locked_by: null,
    });
  });

  it("killUnknown throws on an update error", async () => {
    const { admin } = fakeAdmin({ updateError: { message: "boom" } });
    const ports = createRunnerPorts(admin);

    await expect(ports.killUnknown("job-1", "unknown_type")).rejects.toMatchObject({ message: "boom" });
  });

  it("dispatch throws UnknownJobTypeError for a type with no registered handler", async () => {
    const { admin } = fakeAdmin();
    const ports = createRunnerPorts(admin);

    await expect(ports.dispatch(makeJob({ type: "totally.unregistered" }))).rejects.toThrow(
      UnknownJobTypeError,
    );
  });

  it("dispatch invokes the registered placeholder handler for a known type, which throws not_implemented", async () => {
    const { admin } = fakeAdmin();
    const ports = createRunnerPorts(admin);

    await expect(ports.dispatch(makeJob({ type: "notify.attendance_absence" }))).rejects.toThrow(
      /not_implemented/,
    );
  });
});

describe("resolveHandler (T-037 security review, MEDIUM — prototype-key lookup)", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "treats %s as an unregistered type, not an inherited Object.prototype member",
    (type) => {
      expect(resolveHandler(type)).toBeUndefined();
    },
  );

  it.each(["constructor", "__proto__", "toString"])(
    "dispatch dead-letters %s as UnknownJobTypeError instead of running Object as a handler",
    async (type) => {
      const { admin } = fakeAdmin();
      const ports = createRunnerPorts(admin);

      await expect(ports.dispatch(makeJob({ type }))).rejects.toThrow(UnknownJobTypeError);
    },
  );
});

describe("sanitizeLastError (T-037 security review, MEDIUM — redact + cap before persisting)", () => {
  it("redacts an email, phone number, and Aadhaar-like id", () => {
    const message = "failed for guardian a@b.com, phone 9876543210, id 1234 5678 9012";
    const sanitized = sanitizeLastError(message);

    expect(sanitized).not.toContain("a@b.com");
    expect(sanitized).not.toContain("9876543210");
    expect(sanitized).not.toContain("1234 5678 9012");
    expect(sanitized).toContain("[REDACTED_EMAIL]");
  });

  it("caps the length at ~500 chars", () => {
    const sanitized = sanitizeLastError("x".repeat(1000));
    expect(sanitized.length).toBeLessThanOrEqual(501); // 500 chars + the "…" marker
  });

  it("leaves a short, PII-free message unchanged", () => {
    expect(sanitizeLastError("not_implemented:notify.attendance_absence")).toBe(
      "not_implemented:notify.attendance_absence",
    );
  });
});

describe("withJobsServiceRole (T-035 lesson — guard must relock after the runner creates its client)", () => {
  const ORIGINAL_ENV = { ...process.env };

  it("does not leave SERVICE_ROLE_CALLER unlocked for the rest of the process", async () => {
    delete process.env.SERVICE_ROLE_CALLER;
    const { withJobsServiceRole } = await import("@/modules/jobs/with-service-role");

    expect(withJobsServiceRole(() => process.env.SERVICE_ROLE_CALLER)).toBe("jobs");
    expect(process.env.SERVICE_ROLE_CALLER).toBeUndefined();

    const { createAdminClient } = await import("@/lib/supabase/admin");
    expect(() => createAdminClient()).toThrow(/SERVICE_ROLE_CALLER/);

    process.env = { ...ORIGINAL_ENV };
  });

  it("restores a previous caller instead of deleting it", async () => {
    process.env.SERVICE_ROLE_CALLER = "ai";
    const { withJobsServiceRole } = await import("@/modules/jobs/with-service-role");

    expect(withJobsServiceRole(() => process.env.SERVICE_ROLE_CALLER)).toBe("jobs");
    expect(process.env.SERVICE_ROLE_CALLER).toBe("ai");

    process.env = { ...ORIGINAL_ENV };
  });
});
