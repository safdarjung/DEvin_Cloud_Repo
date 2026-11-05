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
    enqueueDueReports: vi.fn(async () => 0),
    enqueueDueWorkflows: vi.fn(async () => 0),
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

  it("sweeps for due reports exactly once, before the first claimJob", async () => {
    const calls: string[] = [];
    const claimJob = vi.fn(async () => {
      calls.push("claimJob");
      return null;
    });
    const enqueueDueReports = vi.fn(async () => {
      calls.push("enqueueDueReports");
      return 2;
    });
    const ports = fakePorts({ claimJob, enqueueDueReports });

    await runOnceCore({ workerId: "w1" }, ports);

    expect(enqueueDueReports).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["enqueueDueReports", "claimJob"]);
  });

  it("still claims jobs and leaves the summary unchanged when the report sweep rejects", async () => {
    const job = makeJob();
    const claimJob = vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    const completeJob = vi.fn(async () => {});
    const enqueueDueReports = vi.fn(async () => {
      throw new Error("sweep boom");
    });
    const ports = fakePorts({ claimJob, completeJob, enqueueDueReports });

    const summary = await runOnceCore({ workerId: "w1" }, ports);

    expect(summary).toEqual({ claimed: 1, succeeded: 1, requeued: 0, dead: 0 });
    expect(completeJob).toHaveBeenCalledWith(job.id, true);
  });

  it("sweeps for due workflows exactly once, after the report sweep and before the first claimJob", async () => {
    const calls: string[] = [];
    const claimJob = vi.fn(async () => {
      calls.push("claimJob");
      return null;
    });
    const enqueueDueReports = vi.fn(async () => {
      calls.push("enqueueDueReports");
      return 2;
    });
    const enqueueDueWorkflows = vi.fn(async () => {
      calls.push("enqueueDueWorkflows");
      return 3;
    });
    const ports = fakePorts({ claimJob, enqueueDueReports, enqueueDueWorkflows });

    await runOnceCore({ workerId: "w1" }, ports);

    expect(enqueueDueWorkflows).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["enqueueDueReports", "enqueueDueWorkflows", "claimJob"]);
  });

  it("still claims jobs and leaves the summary unchanged when the workflows sweep rejects", async () => {
    const job = makeJob();
    const claimJob = vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    const completeJob = vi.fn(async () => {});
    const enqueueDueWorkflows = vi.fn(async () => {
      throw new Error("workflows sweep boom");
    });
    const ports = fakePorts({ claimJob, completeJob, enqueueDueWorkflows });

    const summary = await runOnceCore({ workerId: "w1" }, ports);

    expect(summary).toEqual({ claimed: 1, succeeded: 1, requeued: 0, dead: 0 });
    expect(completeJob).toHaveBeenCalledWith(job.id, true);
  });
});

// Minimal fake of the one supabase-js surface `createRunnerPorts` touches:
// `.rpc(fn, args)` for the jobs_claim/jobs_complete wrappers (20261028000012),
// `.from('jobs').update(...).eq('id', id)` for the unknown-type kill path,
// and (MOD-T11) `.from('institutions').select('settings').eq('id', id).single()`
// for the module gate — `institutionSettings` defaults to `{}` (every
// batch-2 module's catalog default applies, so a job type's module reads as
// on unless a test says otherwise). No real Postgres connection anywhere in
// this module (lead rework: the web route must use the service role, never
// a superuser DSN).
function fakeAdmin(opts: {
  rpcResult?: { data: unknown; error: { message: string } | null };
  updateError?: { message: string } | null;
  institutionSettings?: Record<string, unknown> | null;
} = {}): {
  admin: SupabaseClient<Database>;
  rpc: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(async () => opts.rpcResult ?? { data: null, error: null });
  const eq = vi.fn(async () => ({ error: opts.updateError ?? null }));
  const update = vi.fn(() => ({ eq }));
  const single = vi.fn(async () => ({ data: { settings: opts.institutionSettings ?? {} }, error: null }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
  const from = vi.fn((table: string) => (table === "institutions" ? { select } : { update }));
  const admin = { rpc, from } as unknown as SupabaseClient<Database>;
  return { admin, rpc, update, from };
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

  it("dispatch invokes the real notify.recheck_decided handler for a known type, which validates its payload before touching the DB", async () => {
    const { admin } = fakeAdmin();
    const ports = createRunnerPorts(admin);

    // T-038 replaced the notify.attendance_absence placeholder with a real
    // handler, T-031 replaced finance.generate_term_invoices's, T-019
    // replaced notify.results_published's, and T-020 replaces
    // notify.recheck_decided's (06 §W8's `recheck_decisions` rows now exist
    // for real) — every registered type is a real handler, so this case now
    // tests the handler's own missing-payload guard instead of a
    // not-implemented placeholder.
    await expect(
      ports.dispatch(makeJob({ type: "notify.recheck_decided", payload: {} })),
    ).rejects.toThrow(/missing request_id/);
  });

  // MOD-T11 (rulings "Jobs") — JOB_MODULES gate.
  it("dispatch resolves without touching the handler when the job's module is off for the institution", async () => {
    const { admin, from } = fakeAdmin({ institutionSettings: { modules: { exams: false } } });
    const ports = createRunnerPorts(admin);

    await expect(
      ports.dispatch(makeJob({ type: "notify.recheck_decided", payload: {} })),
    ).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith("institutions");
  });

  it("dispatch still runs a core job type's handler with no institutions lookup (no JOB_MODULES row)", async () => {
    const { admin, from } = fakeAdmin();
    const ports = createRunnerPorts(admin);

    // notify.attendance_absence is core (no JOB_MODULES row): its own real
    // handler runs and fails on this job's empty payload, same validation
    // shape as the recheck_decided case above — proving the gate was
    // skipped entirely rather than reading settings for a core type.
    await expect(ports.dispatch(makeJob({ type: "notify.attendance_absence", payload: {} }))).rejects.toThrow();
    expect(from).not.toHaveBeenCalledWith("institutions");
  });

  it("enqueueDueReports calls the enqueue_due_reports RPC and returns its count", async () => {
    const { admin, rpc } = fakeAdmin({ rpcResult: { data: 2, error: null } });
    const ports = createRunnerPorts(admin);

    await expect(ports.enqueueDueReports()).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith("enqueue_due_reports");
  });

  it("enqueueDueReports throws on an RPC error", async () => {
    const { admin } = fakeAdmin({ rpcResult: { data: null, error: { message: "boom" } } });
    const ports = createRunnerPorts(admin);

    await expect(ports.enqueueDueReports()).rejects.toThrow("boom");
  });

  it("enqueueDueWorkflows calls the enqueue_due_workflows RPC and returns its count", async () => {
    const { admin, rpc } = fakeAdmin({ rpcResult: { data: 3, error: null } });
    const ports = createRunnerPorts(admin);

    await expect(ports.enqueueDueWorkflows()).resolves.toBe(3);
    expect(rpc).toHaveBeenCalledWith("enqueue_due_workflows");
  });

  it("enqueueDueWorkflows throws on an RPC error", async () => {
    const { admin } = fakeAdmin({ rpcResult: { data: null, error: { message: "boom" } } });
    const ports = createRunnerPorts(admin);

    await expect(ports.enqueueDueWorkflows()).rejects.toThrow("boom");
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
