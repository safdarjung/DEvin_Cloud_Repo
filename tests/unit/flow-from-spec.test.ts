import { describe, expect, it } from "vitest";

import { flowFromSpec, type FlowSpec } from "@/lib/genui/flow-from-spec";

describe("flowFromSpec", () => {
  it("maps node and edge fields to React Flow shapes", () => {
    const spec: FlowSpec = {
      nodes: [{ id: "a", label: "A", type: "start" }],
      edges: [{ source: "a", target: "a", label: "loop" }],
    };

    const { nodes, edges } = flowFromSpec(spec);

    expect(nodes).toEqual([
      { id: "a", type: "start", position: { x: 0, y: 0 }, data: { label: "A" } },
    ]);
    expect(edges).toEqual([{ id: "a->a-0", source: "a", target: "a", label: "loop" }]);
  });

  it("assigns deterministic BFS-depth columns and input-order rows when x/y are missing", () => {
    // a -> b -> d
    // a -> c -> d
    const spec: FlowSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "d", label: "D" },
      ],
      edges: [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
        { source: "b", target: "d" },
        { source: "c", target: "d" },
      ],
    };

    const run1 = flowFromSpec(spec);
    const run2 = flowFromSpec(spec);

    expect(run1).toEqual(run2);

    const byId = Object.fromEntries(run1.nodes.map((n) => [n.id, n.position]));
    expect(byId.a).toEqual({ x: 0, y: 0 }); // depth 0, row 0
    expect(byId.b).toEqual({ x: 220, y: 0 }); // depth 1, row 0
    expect(byId.c).toEqual({ x: 220, y: 90 }); // depth 1, row 1
    expect(byId.d).toEqual({ x: 440, y: 0 }); // depth 2 (longest path via b or c), row 0
  });

  it("falls back to appended columns in input order when a cycle prevents BFS depth", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "x", label: "X" },
        { id: "y", label: "Y" },
      ],
      edges: [
        { source: "x", target: "y" },
        { source: "y", target: "x" },
      ],
    };

    const { nodes } = flowFromSpec(spec);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n.position]));

    // Neither node ever reaches in-degree 0; both get appended, in input order.
    expect(byId.x).toEqual({ x: 220, y: 0 });
    expect(byId.y).toEqual({ x: 440, y: 0 });
  });

  it("preserves explicit x/y and skips layout for that node only", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "a", label: "A", x: 500, y: 300 },
        { id: "b", label: "B" },
      ],
      edges: [{ source: "a", target: "b" }],
    };

    const { nodes } = flowFromSpec(spec);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n.position]));

    expect(byId.a).toEqual({ x: 500, y: 300 });
    expect(byId.b).toEqual({ x: 220, y: 0 }); // still laid out from its own BFS depth
  });
});
