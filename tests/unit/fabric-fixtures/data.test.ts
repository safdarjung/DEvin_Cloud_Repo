import { describe, it, expect } from "vitest";
import { connectors, connectorSyncs, dataQualityScores, lineage } from "@/modules/fabric/demo/data";

describe("fabric fixtures: data", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const institutionId = "inst-0001";
  const opts = { seed: 7, now, institutionId };

  describe("connectors", () => {
    it("returns 8 connectors", () => {
      const result = connectors(opts);
      expect(result).toHaveLength(8);
    });

    it("has one failed connector", () => {
      const result = connectors(opts);
      const failed = result.filter((c) => c.status === "failed");
      expect(failed).toHaveLength(1);
    });

    it("has mixed statuses", () => {
      const result = connectors(opts);
      const statuses = new Set(result.map((c) => c.status));
      expect(statuses.size).toBeGreaterThan(1);
    });

    it("deterministic with same seed", () => {
      const r1 = connectors(opts);
      const r2 = connectors(opts);
      expect(r1).toEqual(r2);
    });

    it("all connectors have institution_id", () => {
      const result = connectors(opts);
      result.forEach((c) => {
        expect(c.institution_id).toBe(institutionId);
      });
    });

    it("all connectors have valid owner", () => {
      const result = connectors(opts);
      result.forEach((c) => {
        expect(c.owner).toMatch(/^[a-z.-]+@/);
      });
    });

    it("strings <= 200 chars", () => {
      const result = connectors(opts);
      result.forEach((c) => {
        expect(c.name.length).toBeLessThanOrEqual(200);
        expect(c.provider.length).toBeLessThanOrEqual(200);
        expect(c.slug.length).toBeLessThanOrEqual(200);
      });
    });
  });

  describe("connectorSyncs", () => {
    it("returns 20 syncs", () => {
      const result = connectorSyncs(opts);
      expect(result).toHaveLength(20);
    });

    it("deterministic with same seed", () => {
      const r1 = connectorSyncs(opts);
      const r2 = connectorSyncs(opts);
      expect(r1).toEqual(r2);
    });

    it("every sync references existing connector", () => {
      const conns = connectors(opts);
      const connIds = new Set(conns.map((c) => c.id));
      const syncs = connectorSyncs(opts);

      syncs.forEach((sync) => {
        expect(connIds.has(sync.connector_id)).toBe(true);
      });
    });

    it("syncs within last 7 days", () => {
      const syncs = connectorSyncs(opts);
      // ISO date strings lose time info, so compare date strings
      const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);

      syncs.forEach((sync) => {
        expect(sync.started_at >= startDate).toBe(true);
        expect(sync.started_at <= endDate).toBe(true);
      });
    });

    it("finished_at >= started_at", () => {
      const syncs = connectorSyncs(opts);
      syncs.forEach((sync) => {
        const started = new Date(sync.started_at);
        const finished = new Date(sync.finished_at ?? "");
        expect(finished.getTime()).toBeGreaterThanOrEqual(started.getTime());
      });
    });

    it("failed syncs have errors", () => {
      const syncs = connectorSyncs(opts);
      syncs.forEach((sync) => {
        if (sync.status === "failed") {
          expect(sync.errors.length).toBeGreaterThan(0);
        }
      });
    });

    it("ok syncs have positive records", () => {
      const syncs = connectorSyncs(opts);
      syncs.forEach((sync) => {
        if (sync.status === "ok") {
          expect(sync.records).toBeGreaterThan(0);
        }
      });
    });
  });

  describe("dataQualityScores", () => {
    it("returns 8 scores", () => {
      const result = dataQualityScores(opts);
      expect(result).toHaveLength(8);
    });

    it("covers all expected entities", () => {
      const result = dataQualityScores(opts);
      const entities = result.map((s) => s.entity).sort();
      const expected = ["attendance", "guardians", "invoices", "marks", "staff", "students", "timetable", "transport"].sort();
      expect(entities).toEqual(expected);
    });

    it("deterministic with same seed", () => {
      const r1 = dataQualityScores(opts);
      const r2 = dataQualityScores(opts);
      expect(r1).toEqual(r2);
    });

    it("scores in 60-100 range", () => {
      const result = dataQualityScores(opts);
      result.forEach((score) => {
        expect(score.score).toBeGreaterThanOrEqual(60);
        expect(score.score).toBeLessThanOrEqual(100);
      });
    });

    it("each entity can have multiple issue kinds", () => {
      const result = dataQualityScores(opts);
      const hasMultiple = result.some((s) => s.issues.length > 1);
      expect(hasMultiple).toBe(true);
    });
  });

  describe("lineage", () => {
    it("returns ~30 nodes", () => {
      const { nodes } = lineage(opts);
      expect(nodes.length).toBeGreaterThanOrEqual(28);
      expect(nodes.length).toBeLessThanOrEqual(32);
    });

    it("returns ~40 edges", () => {
      const { edges } = lineage(opts);
      expect(edges.length).toBeGreaterThanOrEqual(38);
      expect(edges.length).toBeLessThanOrEqual(42);
    });

    it("deterministic with same seed", () => {
      const l1 = lineage(opts);
      const l2 = lineage(opts);
      expect(l1).toEqual(l2);
    });

    it("all edge endpoints exist in nodes", () => {
      const { nodes, edges } = lineage(opts);
      const nodeIds = new Set(nodes.map((n) => n.id));

      edges.forEach((edge) => {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      });
    });

    it("has all four node types", () => {
      const { nodes } = lineage(opts);
      const types = new Set(nodes.map((n) => n.type));
      expect(types).toContain("source");
      expect(types).toContain("table");
      expect(types).toContain("metric");
      expect(types.has("report") || types.has("widget")).toBe(true);
    });

    it("nodes positioned in columns 220px apart", () => {
      const { nodes } = lineage(opts);
      const xCoords = new Set(nodes.map((n) => n.x ?? 0));
      const sorted = Array.from(xCoords).sort((a, b) => (a ?? 0) - (b ?? 0));

      for (let i = 1; i < sorted.length; i++) {
        const curr = sorted[i] ?? 0;
        const prev = sorted[i - 1] ?? 0;
        const diff = curr - prev;
        expect(diff).toBe(220);
      }
    });

    it("strings <= 200 chars", () => {
      const { nodes } = lineage(opts);
      nodes.forEach((n) => {
        expect(n.label.length).toBeLessThanOrEqual(200);
      });
    });
  });

  describe("determinism across all fixtures", () => {
    it("same seed produces same data across all functions", () => {
      const r1 = {
        connectors: connectors(opts),
        syncs: connectorSyncs(opts),
        quality: dataQualityScores(opts),
        lineage: lineage(opts),
      };

      const r2 = {
        connectors: connectors(opts),
        syncs: connectorSyncs(opts),
        quality: dataQualityScores(opts),
        lineage: lineage(opts),
      };

      expect(r1).toEqual(r2);
    });

    it("different seed produces different data", () => {
      const opts2 = { ...opts, seed: 42 };
      const r1 = connectors(opts);
      const r2 = connectors(opts2);

      expect(r1).not.toEqual(r2);
    });
  });
});
