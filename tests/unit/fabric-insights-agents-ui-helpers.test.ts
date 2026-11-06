import { describe, expect, it } from "vitest";
import {
  confidencePct,
  insightHref,
  parseDomain,
  parseStatusTab,
  parseUuid,
  sortInsights,
} from "@/modules/insights/components/helpers";
import { formatPaise, runStatusVariant } from "@/modules/agents/components/helpers";

describe("insights/agents ui helpers", () => {
  it("sorts by severity then confidence without mutating input", () => {
    const input = [
      { id: "a", severity: "watch", confidence: 0.9 },
      { id: "b", severity: "critical", confidence: 0.2 },
      { id: "c", severity: "critical", confidence: 0.8 },
    ] as const;
    expect(sortInsights(input).map((i) => i.id)).toEqual(["c", "b", "a"]);
    expect(input[0].id).toBe("a");
  });
  it("falls back to the open tab and rejects unknown domain/uuid", () => {
    expect(parseStatusTab("bogus").key).toBe("open");
    expect(parseStatusTab("resolved").statuses).toEqual(["resolved"]);
    expect(parseDomain("nope")).toBeUndefined();
    expect(parseDomain("finance")).toBe("finance");
    expect(parseUuid("not-a-uuid")).toBeUndefined();
    expect(parseUuid("123e4567-e89b-12d3-a456-426614174000")).toBeDefined();
  });
  it("clamps confidence and builds hrefs", () => {
    expect(confidencePct(1.4)).toBe(100);
    expect(confidencePct(0.456)).toBe(46);
    expect(insightHref("/x", { status: "open" })).toBe("/x");
    expect(insightHref("/x", { status: "new", domain: "finance", id: "i" })).toBe("/x?status=new&domain=finance&id=i");
  });
  it("formats agent values", () => {
    expect(formatPaise(12345)).toBe("₹123.45");
    expect(runStatusVariant("awaiting_approval")).toBe("warning");
  });
});
