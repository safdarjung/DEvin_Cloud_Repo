import { describe, expect, it } from "vitest";
import { SWITCH_ROLE_ACCOUNTS } from "@/lib/auth/demo-accounts";

describe("switch role menu", () => {
  it("lists one login per kind of role, named by the role", () => {
    const labels = SWITCH_ROLE_ACCOUNTS.map((a) => a.label);
    expect(labels).toEqual(["Principal", "Admin", "Admissions", "Accountant", "Exam controller", "Teacher", "Parent", "Student"]);
    expect(new Set(SWITCH_ROLE_ACCOUNTS.map((a) => a.email)).size).toBe(labels.length);
  });
});
