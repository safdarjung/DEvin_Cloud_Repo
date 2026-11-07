import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { cloudStreamErrorText } = await import("@/lib/ai/cloud-stream");

function apiError(statusCode: number): APICallError {
  return new APICallError({ message: "provider said: secret request echo", url: "https://x", requestBodyValues: {}, statusCode });
}

describe("cloudStreamErrorText", () => {
  it("maps a rejected key (401/403), also when wrapped by a retry error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(cloudStreamErrorText(apiError(401))).toBe("The AI provider rejected the configured API key.");
    expect(cloudStreamErrorText({ lastError: apiError(403) })).toBe("The AI provider rejected the configured API key.");
  });

  it("maps 404 and 429, and never returns the provider's own message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(cloudStreamErrorText(apiError(404))).toBe("The configured AI model was not found.");
    expect(cloudStreamErrorText(apiError(429))).toContain("rate-limiting");
    expect(cloudStreamErrorText(new Error("secret request echo"))).not.toContain("secret");
  });
});
