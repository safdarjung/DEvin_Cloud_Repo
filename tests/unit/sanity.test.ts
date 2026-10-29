import { describe, expect, it } from "vitest";

describe("sanity", () => {
  it("runs the unit test project", () => {
    expect(true).toBe(true);
  });

  it("has NODE_ENV defined", () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });
});
