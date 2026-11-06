import { describe, expect, test } from "vitest";
import { describeActionError } from "../../src/lib/action-error";

describe("describeActionError", () => {
  test("maps auth and permission codes to fixed copy", () => {
    expect(describeActionError({ code: "unauthenticated", message: "x" })).toMatch(/sign in/i);
    expect(describeActionError({ code: "forbidden", message: "x" })).toMatch(/permission/i);
  });
  test("keeps the server message for invalid_state and conflict", () => {
    expect(describeActionError({ code: "invalid_state", message: "Leave already decided." })).toBe("Leave already decided.");
  });
  test("appends the first field error for validation_failed", () => {
    expect(describeActionError({ code: "validation_failed", message: "Invalid input.", fieldErrors: { note: ["Too long."] } })).toBe("Invalid input. Too long.");
  });
  test("never returns an empty string", () => {
    expect(describeActionError({ code: "internal", message: "" }).length).toBeGreaterThan(0);
    expect(describeActionError({ code: "ai_unavailable", message: "" }).length).toBeGreaterThan(0);
  });
});
