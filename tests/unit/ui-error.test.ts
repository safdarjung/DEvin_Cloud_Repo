import { describe, expect, test } from "vitest";
import { actionErrorMessage } from "@/lib/actions/ui-error";

describe("actionErrorMessage", () => {
  test("keeps the server message for validation and appends the first field error", () => {
    expect(actionErrorMessage({ code: "validation_failed", message: "Invalid input.", fieldErrors: { score: ["Score cannot exceed maxScore."] } })).toBe(
      "Invalid input. Score cannot exceed maxScore.",
    );
  });
  test("hides raw internal messages", () => {
    expect(actionErrorMessage({ code: "internal", message: "pg exploded" })).toBe("Something went wrong. Try again.");
  });
  test("maps unauthenticated to a sign-in prompt", () => {
    expect(actionErrorMessage({ code: "unauthenticated", message: "x" })).toMatch(/Sign in/);
  });
});
