import { describe, it, expect } from "vitest";
import {
  personalMemories,
  personalGoals,
  workspaces,
  boundaryPreview,
} from "@/modules/fabric/demo/personal";
import type { PersonalMemory } from "@/modules/fabric/types";

const USER_ID = "user-test-001";

describe("personal fixtures", () => {
  const now = new Date("2026-10-31T00:00:00Z");
  const opts = { seed: 7, now, institutionId: "inst-demo" };

  describe("personalMemories", () => {
    it("returns exactly 15 memories", () => {
      const mems = personalMemories(opts, USER_ID);
      expect(mems).toHaveLength(15);
    });

    it("is deterministic with same seed", () => {
      const mems1 = personalMemories(opts, USER_ID);
      const mems2 = personalMemories(opts, USER_ID);
      expect(mems1).toStrictEqual(mems2);
    });

    it("has ~5 memories with is_shared_with_institution=true", () => {
      const mems = personalMemories(opts, USER_ID);
      const shared = mems.filter((m) => m.is_shared_with_institution);
      expect(shared.length).toBe(5);
    });

    it("all strings are ≤300 chars", () => {
      const mems = personalMemories(opts, USER_ID);
      for (const m of mems) {
        expect(m.content.length).toBeLessThanOrEqual(300);
      }
    });

    it("all have user_id set correctly", () => {
      const mems = personalMemories(opts, USER_ID);
      for (const m of mems) {
        expect(m.user_id).toBe(USER_ID);
      }
    });

    it("some have retain_until set", () => {
      const mems = personalMemories(opts, USER_ID);
      const withRetain = mems.filter((m) => m.retain_until !== null);
      expect(withRetain.length).toBeGreaterThan(0);
    });

    it("kinds are mixed", () => {
      const mems = personalMemories(opts, USER_ID);
      const kinds = new Set(mems.map((m) => m.kind));
      expect(kinds.size).toBeGreaterThan(1);
    });
  });

  describe("personalGoals", () => {
    it("returns exactly 4 goals", () => {
      const goals = personalGoals(opts, USER_ID);
      expect(goals).toHaveLength(4);
    });

    it("is deterministic with same seed", () => {
      const goals1 = personalGoals(opts, USER_ID);
      const goals2 = personalGoals(opts, USER_ID);
      expect(goals1).toStrictEqual(goals2);
    });

    it("each goal has 3-5 tasks", () => {
      const goals = personalGoals(opts, USER_ID);
      for (const goal of goals) {
        expect(goal.tasks.length).toBeGreaterThanOrEqual(3);
        expect(goal.tasks.length).toBeLessThanOrEqual(5);
      }
    });

    it("progress_pct is within 0-100", () => {
      const goals = personalGoals(opts, USER_ID);
      for (const goal of goals) {
        expect(goal.progress_pct).toBeGreaterThanOrEqual(0);
        expect(goal.progress_pct).toBeLessThanOrEqual(100);
      }
    });

    it("all have user_id set correctly", () => {
      const goals = personalGoals(opts, USER_ID);
      for (const g of goals) {
        expect(g.user_id).toBe(USER_ID);
      }
    });
  });

  describe("workspaces", () => {
    it("returns 3 workspaces", () => {
      const ws = workspaces(opts);
      expect(ws).toHaveLength(3);
    });

    it("is deterministic with same seed", () => {
      const ws1 = workspaces(opts);
      const ws2 = workspaces(opts);
      expect(ws1).toStrictEqual(ws2);
    });

    it("has personal workspace as current", () => {
      const ws = workspaces(opts);
      const personal = ws.find((w) => w.kind === "personal");
      expect(personal).toBeDefined();
      expect(personal!.is_current).toBe(true);
    });

    it("includes institution workspace", () => {
      const ws = workspaces(opts);
      const institution = ws.find((w) => w.kind === "institution");
      expect(institution).toBeDefined();
      expect(institution!.name).toBe("St Joseph's (teacher)");
    });

    it("includes household workspace", () => {
      const ws = workspaces(opts);
      const household = ws.find((w) => w.kind === "household");
      expect(household).toBeDefined();
    });
  });

  describe("boundaryPreview", () => {
    it("does not mutate input", () => {
      const mems = personalMemories(opts, USER_ID);
      const before = JSON.stringify(mems);
      boundaryPreview(mems);
      const after = JSON.stringify(mems);
      expect(before).toBe(after);
    });

    it("stays + revoked = input length", () => {
      const mems = personalMemories(opts, USER_ID);
      const result = boundaryPreview(mems);
      expect(result.stays.length + result.revoked.length).toBe(mems.length);
    });

    it("revokes institution-sourced context with inferred source", () => {
      // Create test memories manually
      const testMems: PersonalMemory[] = [
        {
          id: "m1",
          user_id: USER_ID,
          kind: "context",
          content: "test",
          source: "inferred",
          is_shared_with_institution: true,
          retain_until: null,
          created_at: "2026-10-31",
          updated_at: "2026-10-31",
        },
      ];
      const result = boundaryPreview(testMems);
      expect(result.revoked).toHaveLength(1);
      expect(result.stays).toHaveLength(0);
    });

    it("removes is_shared_with_institution flag from stays", () => {
      const mems = personalMemories(opts, USER_ID);
      const result = boundaryPreview(mems);
      for (const stay of result.stays) {
        expect(stay.is_shared_with_institution).toBe(false);
      }
    });

    it("includes explanatory note", () => {
      const mems = personalMemories(opts, USER_ID);
      const result = boundaryPreview(mems);
      expect(result.note).toBeTruthy();
      expect(result.note.length).toBeGreaterThan(0);
    });
  });
});
