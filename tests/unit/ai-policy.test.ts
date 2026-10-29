import { describe, expect, it } from "vitest";
import { resolvePlan } from "@/lib/ai/policy";

// 06 §W10/§W11 C-60/C-61 — 3 policies × key present/absent × switch on/off.
describe("resolvePlan", () => {
  it("local_only always returns [local], regardless of cloud config (C-62)", () => {
    expect(resolvePlan({ aiPolicy: "local_only", cloudEnabled: false, hasCloudKey: false })).toEqual(["local"]);
    expect(resolvePlan({ aiPolicy: "local_only", cloudEnabled: true, hasCloudKey: true })).toEqual(["local"]);
  });

  it("cloud_allowed uses cloud only when both the switch and the key are present", () => {
    expect(resolvePlan({ aiPolicy: "cloud_allowed", cloudEnabled: true, hasCloudKey: true })).toEqual(["cloud"]);
    expect(resolvePlan({ aiPolicy: "cloud_allowed", cloudEnabled: true, hasCloudKey: false })).toEqual(["local"]);
    expect(resolvePlan({ aiPolicy: "cloud_allowed", cloudEnabled: false, hasCloudKey: true })).toEqual(["local"]);
    expect(resolvePlan({ aiPolicy: "cloud_allowed", cloudEnabled: false, hasCloudKey: false })).toEqual(["local"]);
  });

  it("local_with_cloud_fallback tries local first, cloud only when configured (C-63)", () => {
    expect(
      resolvePlan({ aiPolicy: "local_with_cloud_fallback", cloudEnabled: true, hasCloudKey: true }),
    ).toEqual(["local", "cloud"]);
    expect(
      resolvePlan({ aiPolicy: "local_with_cloud_fallback", cloudEnabled: true, hasCloudKey: false }),
    ).toEqual(["local"]);
    expect(
      resolvePlan({ aiPolicy: "local_with_cloud_fallback", cloudEnabled: false, hasCloudKey: true }),
    ).toEqual(["local"]);
  });
});
