import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTITUTION_SETTINGS,
  InstitutionSettingsSchema,
} from "@/modules/core/schemas";

describe("InstitutionSettingsSchema", () => {
  it("accepts the 05 §4.1 default settings verbatim", () => {
    expect(() => InstitutionSettingsSchema.parse(DEFAULT_INSTITUTION_SETTINGS)).not.toThrow();
  });

  it("rejects a bad grading band (max > 100)", () => {
    const broken = structuredClone(DEFAULT_INSTITUTION_SETTINGS);
    broken.exams.grading_scales.default[0].max = 150;

    expect(() => InstitutionSettingsSchema.parse(broken)).toThrow();
  });

  it("rejects an unknown top-level key", () => {
    const broken = { ...DEFAULT_INSTITUTION_SETTINGS, extra: true };

    expect(() => InstitutionSettingsSchema.parse(broken)).toThrow();
  });

  // D33 — features moved from an open z.record to a closed, named set.
  it("rejects an unknown feature key", () => {
    const broken = structuredClone(DEFAULT_INSTITUTION_SETTINGS) as typeof DEFAULT_INSTITUTION_SETTINGS & {
      features: Record<string, boolean>;
    };
    broken.features.not_a_real_feature = true;

    expect(() => InstitutionSettingsSchema.parse(broken)).toThrow();
  });
});
