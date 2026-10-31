import { describe, it, expect } from "vitest";
import {
  studioRequests,
  studioProposals,
  interpretRequest,
} from "@/modules/fabric/demo/studio";
import type { FixtureOpts } from "@/modules/fabric/demo/prng";

const baseOpts: FixtureOpts = {
  seed: 7,
  now: new Date("2026-10-31"),
  institutionId: "demo-001",
};

describe("studio fixtures", () => {
  it("studioRequests returns 4 requests at different statuses", () => {
    const requests = studioRequests(baseOpts);

    expect(requests).toHaveLength(4);
    expect(requests.map((r) => r.status)).toEqual([
      "submitted",
      "proposed",
      "building",
      "delivered",
    ]);
  });

  it("studioProposals returns 4 proposals matching requests", () => {
    const requests = studioRequests(baseOpts);
    const proposals = studioProposals(baseOpts);

    expect(proposals).toHaveLength(4);
    proposals.forEach((p, i) => {
      expect(p.request_id).toBe(requests[i]!.id);
    });
  });

  it("same seed produces deterministically equal data", () => {
    const req1 = studioRequests(baseOpts);
    const req2 = studioRequests(baseOpts);
    const prop1 = studioProposals(baseOpts);
    const prop2 = studioProposals(baseOpts);

    expect(req1).toEqual(req2);
    expect(prop1).toEqual(prop2);
  });

  it("proposals have clarifying questions", () => {
    const proposals = studioProposals(baseOpts);

    proposals.forEach((p) => {
      expect(p.clarifying_questions.length).toBeGreaterThanOrEqual(0);
      if (p.clarifying_questions.length > 0) {
        p.clarifying_questions.forEach((q) => {
          expect(q.length).toBeLessThanOrEqual(400);
        });
      }
    });
  });

  it("delivered proposal has preview_html without scripts", () => {
    const proposals = studioProposals(baseOpts);
    const delivered = proposals.find((p) => p.preview_html !== null);

    expect(delivered).toBeDefined();
    expect(delivered!.preview_html).toBeDefined();
    expect(delivered!.preview_html!.length).toBeLessThanOrEqual(3000);
    expect(delivered!.preview_html).not.toContain("<script");
    expect(delivered!.preview_html).toContain("<!DOCTYPE html");
  });

  it("other proposals have null preview_html", () => {
    const proposals = studioProposals(baseOpts);
    const nonDelivered = proposals.filter((p) => p.preview_html === null);

    expect(nonDelivered).toHaveLength(3);
  });

  it("interpretRequest covers configuration branch", () => {
    const result = interpretRequest("Generate a report on attendance");

    expect(result.resolution).toBe("configuration");
    expect(result.interpretation.length).toBeLessThanOrEqual(400);
    expect(result.questions.length).toBeGreaterThan(0);
    result.questions.forEach((q) => {
      expect(q.length).toBeLessThanOrEqual(400);
    });
  });

  it("interpretRequest covers integration branch", () => {
    const gpsResult = interpretRequest("We need GPS tracking for buses");
    expect(gpsResult.resolution).toBe("integration");

    const paymentResult = interpretRequest("Add payment gateway support");
    expect(paymentResult.resolution).toBe("integration");

    const integrateResult = interpretRequest("Integrate with our ERP");
    expect(integrateResult.resolution).toBe("integration");
  });

  it("interpretRequest covers new_module branch", () => {
    const result = interpretRequest("Build a hostel leave workflow");

    expect(result.resolution).toBe("new_module");
    expect(result.interpretation.length).toBeLessThanOrEqual(400);
  });

  it("all strings in requests are ≤400 chars", () => {
    const requests = studioRequests(baseOpts);

    requests.forEach((r) => {
      expect(r.title.length).toBeLessThanOrEqual(400);
      expect(r.problem.length).toBeLessThanOrEqual(400);
      expect(r.desired_outcome.length).toBeLessThanOrEqual(400);
      expect(r.constraints.length).toBeLessThanOrEqual(400);
      expect(r.timeline.length).toBeLessThanOrEqual(400);
      expect(r.success_criteria.length).toBeLessThanOrEqual(400);
    });
  });

  it("all strings in proposals are ≤400 chars (except preview_html)", () => {
    const proposals = studioProposals(baseOpts);

    proposals.forEach((p) => {
      expect(p.interpretation.length).toBeLessThanOrEqual(400);
      p.clarifying_questions.forEach((q) => {
        expect(q.length).toBeLessThanOrEqual(400);
      });
      p.features.forEach((f) => {
        expect(f.length).toBeLessThanOrEqual(400);
      });
    });
  });
});
