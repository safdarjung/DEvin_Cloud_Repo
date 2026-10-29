// 04 §5, 06 §W10/§W11 — pure plan resolver: no I/O, no provider imports, so
// it never pulls `@ai-sdk/anthropic` into the process and is trivially
// unit-testable (C-60, C-61).

export type AiPolicy = "local_only" | "cloud_allowed" | "local_with_cloud_fallback";
export type ProviderStep = "local" | "cloud";

export interface ResolvePlanInput {
  aiPolicy: AiPolicy;
  cloudEnabled: boolean;
  hasCloudKey: boolean;
}

/**
 * Resolves the ordered list of providers the gateway may try.
 * - `local_only`: always `["local"]` — cloud is never in the plan (C-62),
 *   regardless of env, so the gateway never even has a reason to import the
 *   cloud provider module.
 * - `cloud_allowed`: cloud when configured (switch + key), else local — no
 *   fallback between them (06 §W11).
 * - `local_with_cloud_fallback`: local first; cloud appended only when
 *   configured, tried only after local fails (06 §W11).
 */
export function resolvePlan({ aiPolicy, cloudEnabled, hasCloudKey }: ResolvePlanInput): ProviderStep[] {
  const cloudConfigured = cloudEnabled && hasCloudKey;

  switch (aiPolicy) {
    case "local_only":
      return ["local"];
    case "cloud_allowed":
      return cloudConfigured ? ["cloud"] : ["local"];
    case "local_with_cloud_fallback":
      return cloudConfigured ? ["local", "cloud"] : ["local"];
    default:
      return ["local"];
  }
}
