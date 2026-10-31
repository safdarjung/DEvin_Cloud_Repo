// F-BE-04 — Fabric demo store: reducer intents, immutability, reset,
// persist version-gating, and import validation.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioProposal } from "@/modules/fabric/types";
import { initialState, type DemoState } from "@/modules/fabric/store/state";
import { reduce } from "@/modules/fabric/store/reducer";
import { STORAGE_KEY, loadState, parseImport, saveState } from "@/modules/fabric/store/persist";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const install = (id: string, status: "pending_approval" | "installed" | "disabled" | "uninstalled" = "installed") => ({
  id,
  institution_id: "inst-1",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  module_id: "mod-1",
  status,
  version: "1.0.0",
  installed_by: "user-1",
  config: {},
});

const scenario = (id: string) => ({
  id,
  institution_id: "inst-1",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  name: "Baseline",
  status: "draft" as const,
  is_baseline: true,
  assumptions: {
    enrolment_delta_pct: 0,
    staff_delta: 0,
    fee_change_pct: 0,
    cost_change_pct: 0,
    periods_per_day: 8,
    horizon_months: 12,
  },
  results: null,
  rationale: "r",
  created_by: "user-1",
});

const request = (id: string, status: DemoState["requests"][number]["status"] = "submitted") => ({
  id,
  institution_id: "inst-1",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  title: "t",
  problem: "p",
  desired_outcome: "o",
  user_roles: [],
  existing_systems: [],
  integrations: [],
  constraints: "c",
  budget_range: "unknown" as const,
  timeline: "t",
  success_criteria: "s",
  status,
  requested_by: "user-1",
});

const proposal = (
  id: string,
  requestId: string,
  pipeline: StudioProposal["pipeline"],
): StudioProposal => ({
  id,
  institution_id: "inst-1",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  request_id: requestId,
  version: 1,
  resolution: "new_module" as const,
  interpretation: "i",
  clarifying_questions: [],
  features: [],
  workflows: [],
  ux_outline: [],
  technical_requirements: [],
  integration_requirements: [],
  permission_requirements: [],
  cost_estimate_paise: 0,
  timeline_weeks: 1,
  risks: [],
  acceptance_criteria: [],
  pipeline,
  preview_html: null,
});

const workflow = (id: string, status: "draft" | "active" | "paused" | "disabled" = "draft") => ({
  id,
  institution_id: "inst-1",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  name: "w",
  version: 1,
  status,
  trigger: { type: "manual" as const, config: "" },
  nodes: [],
  edges: [],
  created_by: "user-1",
});

const memory = (id: string) => ({
  id,
  user_id: "user-1",
  kind: "fact" as const,
  content: "c",
  source: "user" as const,
  is_shared_with_institution: false,
  retain_until: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

const goal = (id: string, tasks: { id: string; title: string; done: boolean }[]) => ({
  id,
  user_id: "user-1",
  title: "g",
  progress_pct: 0,
  due_date: null,
  tasks,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

const intervention = (id: string) => ({
  id,
  student_id: "student-1",
  owner: "user-1",
  goal: "g",
  steps: [],
  status: "proposed" as const,
  review_date: "2026-11-01",
  restricted: true as const,
});

const insightAction = (id: string, status: "planned" | "done" | "measured" = "planned") => ({
  id,
  institution_id: "inst-1",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  insight_id: "insight-1",
  action: "a",
  owner: "user-1",
  rationale: "r",
  expected_outcome: "e",
  actual_outcome: null,
  decided_at: "2026-10-01T00:00:00Z",
  measured_at: null,
  status,
});

describe("reduce — intents", () => {
  it("setLayout sets widget order for a key", () => {
    const s = deepFreeze(initialState());
    const next = reduce(s, { type: "setLayout", key: "dashboard", order: ["a", "b"] });
    expect(next.layouts.dashboard).toEqual(["a", "b"]);
  });

  it("installModule adds a row; uninstallModule removes it", () => {
    let s = deepFreeze(initialState());
    s = deepFreeze(reduce(s, { type: "installModule", install: install("m1") }));
    expect(s.installs).toHaveLength(1);
    s = reduce(s, { type: "uninstallModule", id: "m1" });
    expect(s.installs).toHaveLength(0);
  });

  it("setInstallStatus updates status", () => {
    const s = deepFreeze(initialState({ installs: [install("m1", "pending_approval")] }));
    const next = reduce(s, { type: "setInstallStatus", id: "m1", status: "installed" });
    expect(next.installs[0].status).toBe("installed");
  });

  it("saveScenario upserts; deleteScenario removes", () => {
    let s = deepFreeze(initialState());
    s = deepFreeze(reduce(s, { type: "saveScenario", scenario: scenario("sc1") }));
    expect(s.scenarios).toHaveLength(1);
    s = reduce(s, { type: "deleteScenario", id: "sc1" });
    expect(s.scenarios).toHaveLength(0);
  });

  it("submitRequest adds; setRequestStatus updates", () => {
    let s = deepFreeze(initialState());
    s = deepFreeze(reduce(s, { type: "submitRequest", request: request("r1") }));
    const next = reduce(s, { type: "setRequestStatus", id: "r1", status: "approved" });
    expect(next.requests[0].status).toBe("approved");
  });

  it("saveProposal upserts by id", () => {
    const s = deepFreeze(initialState());
    const next = reduce(s, { type: "saveProposal", proposal: proposal("p1", "r1", []) });
    expect(next.proposals).toHaveLength(1);
  });

  it("advancePipeline starts the first pending stage, then advances running to done + next to running", () => {
    let s = deepFreeze(
      initialState({
        proposals: [
          proposal("p1", "r1", [
            { stage: "research", status: "pending" },
            { stage: "architect", status: "pending" },
          ]),
        ],
      }),
    );
    s = deepFreeze(reduce(s, { type: "advancePipeline", request_id: "r1" }));
    expect(s.proposals[0].pipeline[0].status).toBe("running");
    s = reduce(s, { type: "advancePipeline", request_id: "r1" });
    expect(s.proposals[0].pipeline[0].status).toBe("done");
    expect(s.proposals[0].pipeline[1].status).toBe("running");
  });

  it("advancePipeline is a no-op when request_id has no proposal", () => {
    const s = deepFreeze(initialState());
    expect(reduce(s, { type: "advancePipeline", request_id: "ghost" })).toBe(s);
  });

  it("saveWorkflow upserts; setWorkflowStatus updates", () => {
    let s = deepFreeze(initialState());
    s = deepFreeze(reduce(s, { type: "saveWorkflow", workflow: workflow("w1") }));
    const next = reduce(s, { type: "setWorkflowStatus", id: "w1", status: "active" });
    expect(next.workflows[0].status).toBe("active");
  });

  it("upsertMemory adds/updates; deleteMemory removes", () => {
    let s = deepFreeze(initialState());
    s = deepFreeze(reduce(s, { type: "upsertMemory", memory: memory("mem1") }));
    expect(s.memories).toHaveLength(1);
    s = reduce(s, { type: "deleteMemory", id: "mem1" });
    expect(s.memories).toHaveLength(0);
  });

  it("upsertGoal adds; toggleTask flips done", () => {
    let s = deepFreeze(initialState());
    s = deepFreeze(reduce(s, { type: "upsertGoal", goal: goal("g1", [{ id: "t1", title: "x", done: false }]) }));
    const next = reduce(s, { type: "toggleTask", goal_id: "g1", task_id: "t1" });
    expect(next.goals[0].tasks[0].done).toBe(true);
  });

  it("toggleTask is a no-op for a missing goal or task", () => {
    const s = deepFreeze(initialState({ goals: [goal("g1", [{ id: "t1", title: "x", done: false }])] }));
    expect(reduce(s, { type: "toggleTask", goal_id: "ghost", task_id: "t1" })).toBe(s);
    expect(reduce(s, { type: "toggleTask", goal_id: "g1", task_id: "ghost" })).toBe(s);
  });

  it("saveIntervention upserts by id", () => {
    const s = deepFreeze(initialState());
    const next = reduce(s, { type: "saveIntervention", intervention: intervention("iv1") });
    expect(next.interventions).toHaveLength(1);
  });

  it("setInsightStatus sets status for an insight id", () => {
    const s = deepFreeze(initialState());
    const next = reduce(s, { type: "setInsightStatus", insight_id: "ins1", status: "reviewing" });
    expect(next.insightStatus.ins1).toBe("reviewing");
  });

  it("recordInsightAction adds; measureOutcome records the actual outcome", () => {
    let s = deepFreeze(initialState());
    s = deepFreeze(reduce(s, { type: "recordInsightAction", action: insightAction("ia1") }));
    const next = reduce(s, { type: "measureOutcome", action_id: "ia1", actual_outcome: "worked" });
    expect(next.insightActions[0].actual_outcome).toBe("worked");
    expect(next.insightActions[0].status).toBe("measured");
    expect(next.insightActions[0].measured_at).not.toBeNull();
  });

  it("setNote sets a note by key", () => {
    const s = deepFreeze(initialState());
    const next = reduce(s, { type: "setNote", key: "k1", text: "hello" });
    expect(next.notes.k1).toBe("hello");
  });

  it("importState replaces the whole state", () => {
    const s = deepFreeze(initialState());
    const imported = initialState({ notes: { a: "b" } });
    expect(reduce(s, { type: "importState", state: imported })).toBe(imported);
  });

  it("reset returns a fresh initial state, optionally seeded", () => {
    const s = deepFreeze(initialState({ notes: { a: "b" } }));
    const next = reduce(s, { type: "reset" });
    expect(next.notes).toEqual({});
    const reseeded = reduce(s, { type: "reset", seedData: { notes: { x: "y" } } });
    expect(reseeded.notes).toEqual({ x: "y" });
  });
});

describe("reduce — immutability and no-op refs", () => {
  it("never throws against a deeply frozen input state", () => {
    const s = deepFreeze(
      initialState({
        installs: [install("m1")],
        scenarios: [scenario("sc1")],
        goals: [goal("g1", [{ id: "t1", title: "x", done: false }])],
      }),
    );
    expect(() => reduce(s, { type: "setLayout", key: "k", order: ["a"] })).not.toThrow();
    expect(() => reduce(s, { type: "toggleTask", goal_id: "g1", task_id: "t1" })).not.toThrow();
    expect(() => reduce(s, { type: "deleteScenario", id: "sc1" })).not.toThrow();
  });

  it("returns the same state reference when deleting a missing id", () => {
    const s = deepFreeze(initialState());
    expect(reduce(s, { type: "deleteScenario", id: "ghost" })).toBe(s);
    expect(reduce(s, { type: "deleteMemory", id: "ghost" })).toBe(s);
    expect(reduce(s, { type: "uninstallModule", id: "ghost" })).toBe(s);
  });

  it("returns the same reference when setting an identical note or insight status", () => {
    const s = deepFreeze(initialState({ notes: { k: "v" }, insightStatus: { ins1: "new" } }));
    expect(reduce(s, { type: "setNote", key: "k", text: "v" })).toBe(s);
    expect(reduce(s, { type: "setInsightStatus", insight_id: "ins1", status: "new" })).toBe(s);
  });
});

describe("persist — localStorage", () => {
  function makeLocalStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saveState then loadState round-trips", () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage() });
    const s = initialState({ notes: { a: "b" } });
    saveState(s);
    const loaded = loadState();
    expect(loaded?.notes).toEqual({ a: "b" });
    expect(loaded?.hydrated).toBe(true);
  });

  it("discards a stored payload with a mismatched version", () => {
    const localStorage = makeLocalStorage();
    vi.stubGlobal("window", { localStorage });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...initialState(), version: 2 }));
    expect(loadState()).toBeNull();
  });

  it("loadState is a no-op without window (SSR)", () => {
    expect(loadState()).toBeNull();
  });
});

describe("parseImport", () => {
  it("rejects malformed JSON", () => {
    const result = parseImport("{not json");
    expect(result.ok).toBe(false);
    expect(result.state).toBeNull();
  });

  it("rejects a payload with an oversize string", () => {
    const tooLong = "x".repeat(4001);
    const bad = { ...initialState(), notes: { a: tooLong } };
    const result = parseImport(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed export", () => {
    const good = initialState({ notes: { a: "b" } });
    const result = parseImport(JSON.stringify(good));
    expect(result.ok).toBe(true);
    expect(result.state?.notes).toEqual({ a: "b" });
  });
});
