import { describe, it, expect, beforeEach } from "vitest";
import {
  agentDefinitions,
  agentRuns,
  workflows,
  workflowRuns,
} from "@/modules/fabric/demo/agents";
import type { FixtureOpts } from "@/modules/fabric/demo/prng";

describe("Fabric agents fixtures", () => {
  let opts: FixtureOpts;

  beforeEach(() => {
    opts = {
      seed: 42,
      now: new Date("2026-10-31T12:00:00Z"),
      institutionId: "inst-0001",
    };
  });

  describe("agentDefinitions", () => {
    it("returns 8 agents", () => {
      const agents = agentDefinitions(opts);
      expect(agents).toHaveLength(8);
    });

    it("all agents have required fields", () => {
      const agents = agentDefinitions(opts);
      agents.forEach((agent) => {
        expect(agent.id).toBeTruthy();
        expect(agent.institution_id).toBe(opts.institutionId);
        expect(agent.slug).toBeTruthy();
        expect(agent.name).toBeTruthy();
        expect(agent.name.length).toBeLessThanOrEqual(200);
        expect(agent.tools).toBeDefined();
        expect(agent.permissions).toBeDefined();
        expect(["local", "cloud_small", "cloud_large"]).toContain(agent.model_tier);
        expect([
          "read_only",
          "low_risk_reversible",
          "user_confirmed",
          "human_approved",
        ]).toContain(agent.max_risk_class);
        expect(typeof agent.is_enabled).toBe("boolean");
        expect(agent.error_rate_pct).toBeGreaterThanOrEqual(0);
        expect(agent.error_rate_pct).toBeLessThanOrEqual(100);
      });
    });

    it("same seed produces identical results", () => {
      const a1 = agentDefinitions(opts);
      const a2 = agentDefinitions(opts);
      expect(a1).toEqual(a2);
    });
  });

  describe("agentRuns", () => {
    it("returns 30 runs", () => {
      const runs = agentRuns(opts);
      expect(runs).toHaveLength(30);
    });

    it("3 runs are awaiting_approval", () => {
      const runs = agentRuns(opts);
      const awaitingApproval = runs.filter((r) => r.status === "awaiting_approval");
      expect(awaitingApproval).toHaveLength(3);
    });

    it("all runs reference valid agents", () => {
      const agents = agentDefinitions(opts);
      const agentIds = new Set(agents.map((a) => a.id));
      const runs = agentRuns(opts);

      runs.forEach((run) => {
        expect(agentIds.has(run.agent_id)).toBe(true);
      });
    });

    it("each run has 3–6 log entries", () => {
      const runs = agentRuns(opts);
      runs.forEach((run) => {
        expect(run.log.length).toBeGreaterThanOrEqual(3);
        expect(run.log.length).toBeLessThanOrEqual(6);
      });
    });

    it("all run strings ≤ 200 chars", () => {
      const runs = agentRuns(opts);
      runs.forEach((run) => {
        expect(run.task.length).toBeLessThanOrEqual(200);
        expect(run.summary.length).toBeLessThanOrEqual(200);
        run.log.forEach((log) => {
          expect(log.text.length).toBeLessThanOrEqual(200);
        });
      });
    });

    it("same seed produces identical results", () => {
      const r1 = agentRuns(opts);
      const r2 = agentRuns(opts);
      expect(r1).toEqual(r2);
    });
  });

  describe("workflows", () => {
    it("returns 5 workflows", () => {
      const wfs = workflows(opts);
      expect(wfs).toHaveLength(5);
    });

    it("each workflow has 6–9 nodes", () => {
      const wfs = workflows(opts);
      wfs.forEach((wf) => {
        expect(wf.nodes.length).toBeGreaterThanOrEqual(6);
        expect(wf.nodes.length).toBeLessThanOrEqual(9);
      });
    });

    it("first node is trigger, last is end", () => {
      const wfs = workflows(opts);
      wfs.forEach((wf) => {
        expect(wf.nodes[0].type).toBe("trigger");
        expect(wf.nodes[wf.nodes.length - 1].type).toBe("end");
      });
    });

    it("each workflow has ≥1 approval node", () => {
      const wfs = workflows(opts);
      wfs.forEach((wf) => {
        const approvalNodes = wf.nodes.filter((n) => n.type === "approval");
        expect(approvalNodes.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("nodes are laid left→right 220px apart", () => {
      const wfs = workflows(opts);
      wfs.forEach((wf) => {
        wf.nodes.forEach((node, i) => {
          if (node.x !== undefined) {
            expect(node.x).toBe(i * 220);
          }
        });
      });
    });

    it("all edges have valid endpoints", () => {
      const wfs = workflows(opts);
      wfs.forEach((wf) => {
        const nodeIds = new Set(wf.nodes.map((n) => n.id));
        wf.edges.forEach((edge) => {
          expect(nodeIds.has(edge.source)).toBe(true);
          expect(nodeIds.has(edge.target)).toBe(true);
        });
      });
    });

    it("same seed produces identical results", () => {
      const w1 = workflows(opts);
      const w2 = workflows(opts);
      expect(w1).toEqual(w2);
    });
  });

  describe("workflowRuns", () => {
    it("returns 8 workflow runs", () => {
      const runs = workflowRuns(opts);
      expect(runs).toHaveLength(8);
    });

    it("all runs reference valid workflows", () => {
      const wfs = workflows(opts);
      const wfIds = new Set(wfs.map((w) => w.id));
      const runs = workflowRuns(opts);

      runs.forEach((run) => {
        expect(wfIds.has(run.workflow_id)).toBe(true);
      });
    });

    it("each run has valid step node_ids", () => {
      const wfs = workflows(opts);
      const runs = workflowRuns(opts);

      runs.forEach((run) => {
        const wf = wfs.find((w) => w.id === run.workflow_id);
        expect(wf).toBeDefined();
        if (wf) {
          const nodeIds = new Set(wf.nodes.map((n) => n.id));
          run.steps.forEach((step) => {
            expect(nodeIds.has(step.node_id)).toBe(true);
          });
        }
      });
    });

    it("step order matches workflow node order", () => {
      const wfs = workflows(opts);
      const runs = workflowRuns(opts);

      runs.forEach((run) => {
        const wf = wfs.find((w) => w.id === run.workflow_id);
        expect(wf).toBeDefined();
        if (wf) {
          const wfNodeIds = wf.nodes.map((n) => n.id);
          const runNodeIds = run.steps.map((s) => s.node_id);
          expect(runNodeIds).toEqual(wfNodeIds);
        }
      });
    });

    it("same seed produces identical results", () => {
      const wr1 = workflowRuns(opts);
      const wr2 = workflowRuns(opts);
      expect(wr1).toEqual(wr2);
    });
  });

  describe("cross-fixture consistency", () => {
    it("all agentRuns.agent_id reference valid agentDefinitions.id", () => {
      const agents = agentDefinitions(opts);
      const agentIds = new Set(agents.map((a) => a.id));
      const runs = agentRuns(opts);

      runs.forEach((run) => {
        expect(agentIds.has(run.agent_id)).toBe(true);
      });
    });

    it("all workflowRuns.workflow_id reference valid workflows.id", () => {
      const wfs = workflows(opts);
      const wfIds = new Set(wfs.map((w) => w.id));
      const runs = workflowRuns(opts);

      runs.forEach((run) => {
        expect(wfIds.has(run.workflow_id)).toBe(true);
      });
    });

    it("all workflowRuns.steps.node_id are valid for their workflow", () => {
      const wfs = workflows(opts);
      const runs = workflowRuns(opts);

      runs.forEach((run) => {
        const wf = wfs.find((w) => w.id === run.workflow_id);
        expect(wf).toBeDefined();
        if (wf) {
          const nodeIds = new Set(wf.nodes.map((n) => n.id));
          run.steps.forEach((step) => {
            expect(nodeIds.has(step.node_id)).toBe(true);
          });
        }
      });
    });
  });
});
