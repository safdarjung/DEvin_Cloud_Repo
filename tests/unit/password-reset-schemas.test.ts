import { describe, expect, it } from "vitest";
import { ForgotPasswordInput, ResetPasswordInput, isRecoverySession } from "@/app/(auth)/auth/schemas";

describe("ForgotPasswordInput", () => {
  it("accepts a valid email and trims it", () => {
    expect(ForgotPasswordInput.parse({ email: "  teacher@school.in " })).toEqual({ email: "teacher@school.in" });
  });

  it("rejects a malformed or missing email", () => {
    expect(ForgotPasswordInput.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(ForgotPasswordInput.safeParse({ email: null }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(ForgotPasswordInput.safeParse({ email: "a@b.in", redirectTo: "https://evil.test" }).success).toBe(false);
  });
});

describe("ResetPasswordInput", () => {
  it("accepts matching passwords of at least 10 characters", () => {
    expect(ResetPasswordInput.safeParse({ password: "0123456789", confirm: "0123456789" }).success).toBe(true);
  });

  it("rejects a password shorter than 10 characters", () => {
    const result = ResetPasswordInput.safeParse({ password: "012345678", confirm: "012345678" });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.password).toBeDefined();
  });

  it("rejects a password longer than 72 characters", () => {
    const long = "a".repeat(73);
    expect(ResetPasswordInput.safeParse({ password: long, confirm: long }).success).toBe(false);
  });

  it("rejects a confirmation that does not match, on the confirm field", () => {
    const result = ResetPasswordInput.safeParse({ password: "0123456789", confirm: "0123456780" });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.confirm).toEqual(["Passwords do not match."]);
  });
});

describe("isRecoverySession", () => {
  it("is true only for a session minted by a recovery link", () => {
    expect(isRecoverySession({ amr: [{ method: "recovery", timestamp: 1 }] })).toBe(true);
    expect(isRecoverySession({ amr: [{ method: "password", timestamp: 1 }] })).toBe(false);
    expect(isRecoverySession({ amr: ["otp"] })).toBe(false);
    expect(isRecoverySession({})).toBe(false);
    expect(isRecoverySession(null)).toBe(false);
  });
});
