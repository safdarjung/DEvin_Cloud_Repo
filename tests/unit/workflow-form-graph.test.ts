import { describe, expect, test } from "vitest";
import { parseGraph } from "../../src/modules/workflows/graph";
import { WORKFLOW_TEMPLATES } from "../../src/modules/workflows/templates";
import { buildGraph, formFromGraph, type WorkflowForm } from "../../src/modules/workflows/form-graph";

const form: WorkflowForm = {
  trigger: { label: "Manual", config: { kind: "manual" } },
  steps: [
    { type: "approval", label: "Principal OK", config: { prompt: "Send reminder?" } },
    { type: "notify", label: "Tell teachers", config: { audience: "roles", roles: "teacher", message: "Hello {count}" } },
  ],
};

describe("workflow form graph", () => {
  test("built graph passes the server validator", () => {
    const g = buildGraph(form);
    expect(parseGraph(g).ok).toBe(true);
  });
  test("round trips through formFromGraph", () => {
    const g = buildGraph(form);
    expect(formFromGraph(g.nodes, g.edges)).toEqual(form);
  });
  test("seeded absence template is editable in the form", () => {
    const t = WORKFLOW_TEMPLATES[0]!;
    const f = formFromGraph(t.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, config: n.config })), t.edges);
    expect(f?.steps.map((s) => s.type)).toEqual(["condition", "notify"]);
  });
  test("a graph outside the form's shape returns null", () => {
    const g = buildGraph(form);
    const extra = [...g.nodes, { id: "z", type: "end" as const, label: "End", config: {} }];
    expect(formFromGraph(extra, g.edges)).toBeNull();
  });
});
