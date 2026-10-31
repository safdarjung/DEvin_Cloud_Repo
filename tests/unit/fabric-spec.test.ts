import { describe, expect, it } from "vitest";
import { CanvasSpecSchema } from "@/modules/fabric/spec/schemas";

const kpi = (id: string) => ({
  id,
  kind: "widget",
  name: "kpi",
  props: { label: "Attendance", value: "94%", action: { type: "navigate", payload: { to: "attendance" } } },
});

const validSpec = () => ({
  version: 1,
  root: "root",
  nodes: [
    { id: "root", kind: "layout", variant: "grid", cols: 2, children: ["k1", "tabs"] },
    kpi("k1"),
    { id: "tabs", kind: "layout", variant: "tabs", children: ["note", "flow"], tabTitles: ["Notes", "Flow"] },
    { id: "note", kind: "callout", tone: "tip", text: "Fee reminders go out Monday.", action: { type: "export", payload: {} } },
    {
      id: "flow",
      kind: "flow",
      nodes: [
        { id: "a", label: "Enquiry", type: "step" },
        { id: "b", label: "Admission", type: "step", x: 200, y: 0 },
      ],
      edges: [{ source: "a", target: "b", label: "converts" }],
    },
  ],
});

describe("CanvasSpecSchema", () => {
  it("parses a valid spec with layout, widget, block and flow nodes", () => {
    expect(CanvasSpecSchema.safeParse(validSpec()).success).toBe(true);
  });

  it("accepts a single block as root", () => {
    const spec = { version: 1, root: "c", nodes: [{ id: "c", kind: "callout", tone: "info", text: "Hi" }] };
    expect(CanvasSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("rejects an unknown node kind", () => {
    const spec = validSpec();
    spec.nodes.push({ id: "x", kind: "iframe" } as never);
    expect(CanvasSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects a dangling child id", () => {
    const spec = validSpec();
    (spec.nodes[0] as { children: string[] }).children.push("ghost");
    expect(CanvasSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects a dangling root id", () => {
    expect(CanvasSpecSchema.safeParse({ ...validSpec(), root: "ghost" }).success).toBe(false);
  });

  it("rejects a layout cycle", () => {
    const spec = validSpec();
    (spec.nodes[2] as { children: string[] }).children.push("root");
    expect(CanvasSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects duplicate node ids", () => {
    const spec = validSpec();
    spec.nodes.push(kpi("k1") as never);
    expect(CanvasSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects a string over 500 chars", () => {
    const spec = validSpec();
    (spec.nodes[1] as ReturnType<typeof kpi>).props.label = "x".repeat(501);
    expect(CanvasSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects 25 nodes", () => {
    const children = Array.from({ length: 24 }, (_, i) => `k${i}`);
    const spec = {
      version: 1,
      root: "root",
      nodes: [{ id: "root", kind: "layout", variant: "stack", children }, ...children.map(kpi)],
    };
    expect(spec.nodes).toHaveLength(25);
    expect(CanvasSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects a widget node with an unknown name", () => {
    const spec = validSpec();
    (spec.nodes[1] as { name: string }).name = "iframeEmbed";
    expect(CanvasSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects a widget or flow as root", () => {
    expect(CanvasSpecSchema.safeParse({ ...validSpec(), root: "k1" }).success).toBe(false);
    expect(CanvasSpecSchema.safeParse({ ...validSpec(), root: "flow" }).success).toBe(false);
  });

  it("rejects an action payload with more than 10 keys or a value over 200 chars", () => {
    const tooMany = validSpec();
    (tooMany.nodes[1] as ReturnType<typeof kpi>).props.action.payload = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"]),
    ) as never;
    expect(CanvasSpecSchema.safeParse(tooMany).success).toBe(false);

    const tooLong = validSpec();
    (tooLong.nodes[1] as ReturnType<typeof kpi>).props.action.payload = { to: "x".repeat(201) };
    expect(CanvasSpecSchema.safeParse(tooLong).success).toBe(false);
  });

  it("rejects a non-internal href (no javascript: or protocol-relative links)", () => {
    for (const href of ["javascript:alert(1)", "//evil.example", "https://evil.example"]) {
      const spec = validSpec();
      (spec.nodes[1] as { props: Record<string, unknown> }).props.href = href;
      expect(CanvasSpecSchema.safeParse(spec).success).toBe(false);
    }
  });
});
