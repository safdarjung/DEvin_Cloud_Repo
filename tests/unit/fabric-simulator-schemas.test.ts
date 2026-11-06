import { describe, expect, it } from "vitest";
import {
  CreateScenarioSchema,
  DecideScenarioSchema,
  DeleteScenarioSchema,
  ScenarioAssumptionsSchema,
  UpdateScenarioSchema,
} from "@/modules/fabric/simulator.schemas";

const VALID_ASSUMPTIONS = {
  enrolment_delta_pct: 10,
  staff_delta: 2,
  fee_change_pct: 5,
  cost_change_pct: 3,
  periods_per_day: 8,
  horizon_months: 12,
};

describe("ScenarioAssumptionsSchema (F-UI-08 slider bounds)", () => {
  it("accepts values within every slider's documented range", () => {
    expect(ScenarioAssumptionsSchema.safeParse(VALID_ASSUMPTIONS).success).toBe(true);
  });

  it("rejects enrolment_delta_pct outside -20..30", () => {
    expect(ScenarioAssumptionsSchema.safeParse({ ...VALID_ASSUMPTIONS, enrolment_delta_pct: 31 }).success).toBe(false);
    expect(ScenarioAssumptionsSchema.safeParse({ ...VALID_ASSUMPTIONS, enrolment_delta_pct: -21 }).success).toBe(false);
  });

  it("rejects periods_per_day outside 6..9 or non-integer", () => {
    expect(ScenarioAssumptionsSchema.safeParse({ ...VALID_ASSUMPTIONS, periods_per_day: 10 }).success).toBe(false);
    expect(ScenarioAssumptionsSchema.safeParse({ ...VALID_ASSUMPTIONS, periods_per_day: 7.5 }).success).toBe(false);
  });

  it("rejects an unknown field (strict)", () => {
    expect(ScenarioAssumptionsSchema.safeParse({ ...VALID_ASSUMPTIONS, extra: true }).success).toBe(false);
  });
});

describe("CreateScenarioSchema", () => {
  it("accepts a minimal valid input and defaults rationale/status", () => {
    const parsed = CreateScenarioSchema.safeParse({ name: "Probe", assumptions: VALID_ASSUMPTIONS });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rationale).toBe("");
      expect(parsed.data.status).toBe("draft");
    }
  });

  it("rejects an empty name and a name over 80 chars", () => {
    expect(CreateScenarioSchema.safeParse({ name: "", assumptions: VALID_ASSUMPTIONS }).success).toBe(false);
    expect(CreateScenarioSchema.safeParse({ name: "x".repeat(81), assumptions: VALID_ASSUMPTIONS }).success).toBe(false);
  });

  it("rejects status outside draft/proposed", () => {
    const result = CreateScenarioSchema.safeParse({ name: "Probe", assumptions: VALID_ASSUMPTIONS, status: "approved" });
    expect(result.success).toBe(false);
  });
});

describe("UpdateScenarioSchema", () => {
  it("accepts a partial patch (status only)", () => {
    expect(UpdateScenarioSchema.safeParse({ id: crypto.randomUUID(), status: "proposed" }).success).toBe(true);
  });

  it("rejects a non-uuid id", () => {
    expect(UpdateScenarioSchema.safeParse({ id: "not-a-uuid", status: "proposed" }).success).toBe(false);
  });
});

describe("DecideScenarioSchema", () => {
  it("only accepts approved/rejected decisions", () => {
    const id = crypto.randomUUID();
    expect(DecideScenarioSchema.safeParse({ id, decision: "approved" }).success).toBe(true);
    expect(DecideScenarioSchema.safeParse({ id, decision: "rejected" }).success).toBe(true);
    expect(DecideScenarioSchema.safeParse({ id, decision: "draft" }).success).toBe(false);
  });
});

describe("DeleteScenarioSchema", () => {
  it("requires a uuid id and nothing else", () => {
    expect(DeleteScenarioSchema.safeParse({ id: crypto.randomUUID() }).success).toBe(true);
    expect(DeleteScenarioSchema.safeParse({ id: crypto.randomUUID(), extra: 1 }).success).toBe(false);
  });
});
