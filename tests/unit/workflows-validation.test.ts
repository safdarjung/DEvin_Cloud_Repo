// Workflow fixes: empty workflows, per-step validation with field keys, the
// per-section absent metric, and custom agents in agent steps (pure).
import { describe, expect, test } from "vitest";
import { runWorkflow, type EnginePorts } from "../../src/modules/workflows/engine";
import { buildGraph, stepErrorsFromGraph, validateWorkflowForm, type WorkflowForm } from "../../src/modules/workflows/form-graph";
import { parseGraph, stepCount } from "../../src/modules/workflows/graph";

const SECTION = "11111111-2222-4333-8444-555555555555";
const CUSTOM = `custom_${"a".repeat(32)}`;
const manual = { label: "Run by hand", config: { kind: "manual" } };

const sectionCheck: WorkflowForm = {
  trigger: manual,
  steps: [
    {
      type: "condition",
      label: "Absent in X-A",
      config: { metric: "attendance.section_absent_today", op: "gte", value: "0", section: SECTION },
    },
  ],
};

describe("empty workflows", () => {
  test("a trigger -> end graph parses but has zero steps", () => {
    const g = buildGraph({ trigger: manual, steps: [] });
    expect(parseGraph(g).ok).toBe(true);
    expect(stepCount(g.nodes)).toBe(0);
    expect(stepCount(buildGraph(sectionCheck).nodes)).toBe(1);
  });
});

describe("per-section absent metric", () => {
  test("needs a section, and only that metric takes one", () => {
    expect(parseGraph(buildGraph(sectionCheck)).ok).toBe(true);

    const noSection = structuredClone(sectionCheck);
    delete noSection.steps[0]!.config.section;
    const r1 = parseGraph(buildGraph(noSection));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.join()).toContain("node s1: metric attendance.section_absent_today needs a section");

    const strayed = structuredClone(sectionCheck);
    strayed.steps[0]!.config.metric = "exams.papers_next_7_days";
    const r2 = parseGraph(buildGraph(strayed));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.join()).toContain("node s1: unknown config key section");
  });

  test("the engine measures the chosen section and records the number readably", async () => {
    const parsed = parseGraph(buildGraph(sectionCheck));
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const calls: unknown[][] = [];
    const ports: EnginePorts = {
      moduleOn: () => true,
      metric: async (...args) => {
        calls.push(args);
        return 3;
      },
      notify: async () => ({ status: "done", note: "" }),
      report: async () => ({ status: "done", note: "" }),
      agent: async () => ({ status: "done", note: "" }),
      now: () => "2026-11-11T04:30:00.000Z",
    };
    const result = await runWorkflow(parsed.graph, { kind: "trigger" }, ports);
    expect(calls).toEqual([["attendance.section_absent_today", SECTION]]);
    expect(result.status).toBe("done");
    expect(result.lastValue).toBe(3);
    expect(result.steps[1]).toMatchObject({ node_id: "s1", status: "done", note: "Absent today in one section: 3 (is at least 0: yes)" });
  });
});

describe("custom agents in agent steps", () => {
  const withAgent = (agent: string): WorkflowForm => ({ trigger: manual, steps: [{ type: "agent", label: "Ask", config: { agent, task: "Summarise today." } }] });

  test("a catalog slug or a server-made custom slug is allowed; anything else is not", () => {
    expect(parseGraph(buildGraph(withAgent("attendance"))).ok).toBe(true);
    expect(parseGraph(buildGraph(withAgent(CUSTOM))).ok).toBe(true);
    expect(parseGraph(buildGraph(withAgent("custom_nothex"))).ok).toBe(false);
    expect(parseGraph(buildGraph(withAgent("hacker"))).ok).toBe(false);
  });
});

describe("validateWorkflowForm", () => {
  test("a complete form has no errors", () => {
    expect(validateWorkflowForm("Absent in X-A", sectionCheck)).toEqual({});
  });

  test("every step field is checked, keyed by step index", () => {
    const form: WorkflowForm = {
      trigger: { label: "On a schedule", config: { kind: "schedule", cron: "nonsense" } },
      steps: [
        { type: "condition", label: "Check", config: { metric: "", op: "", value: "" } },
        { type: "condition", label: "Check", config: { metric: "attendance.section_absent_today", op: "gte", value: "1" } },
        { type: "notify", label: "Tell", config: { audience: "roles", roles: "", message: "" } },
        { type: "approval", label: "OK?", config: { prompt: "" } },
        { type: "agent", label: "Ask", config: { agent: "", task: "" } },
      ],
    };
    expect(validateWorkflowForm("", form)).toEqual({
      name: ["Give the workflow a name."],
      "trigger.cron": ["Pick when it runs."],
      "steps.0.metric": ["Pick a number to check."],
      "steps.0.op": ["Pick a comparison."],
      "steps.0.value": ["Enter a whole number (0 or more)."],
      "steps.1.section": ["Pick a section."],
      "steps.2.roles": ["Pick at least one role."],
      "steps.2.message": ["Write the message."],
      "steps.3.prompt": ["Write the question for the approver."],
      "steps.4.agent": ["Pick an agent."],
      "steps.4.task": ["Write the task for the agent."],
    });
  });

  test("zero steps is not a field error (it is the explicit empty-draft warning)", () => {
    expect(validateWorkflowForm("Draft", { trigger: manual, steps: [] })).toEqual({});
  });
});

describe("stepErrorsFromGraph", () => {
  test("maps the server's node errors onto step fields and keeps the full list", () => {
    const errors = ["node s2: unknown metric", "graph: at least one end node must be reachable from the trigger"];
    expect(stepErrorsFromGraph(errors)).toEqual({ graph: errors, "steps.1": ["unknown metric"] });
  });
});
