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

  it("rejects AI limits above their caps, so an admin cannot lift spending limits without bound", () => {
    for (const [key, value] of [
      ["daily_token_quota", 10_000_001],
      ["student_daily_token_quota", 10_000_001],
      ["per_user_per_minute", 601],
      ["max_concurrent_local", 65],
      ["max_concurrent_cloud", 65],
    ] as const) {
      const broken = structuredClone(DEFAULT_INSTITUTION_SETTINGS);
      broken.ai[key] = value;
      expect(() => InstitutionSettingsSchema.parse(broken), key).toThrow();
    }
  });
});
