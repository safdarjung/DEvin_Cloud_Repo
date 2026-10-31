import { describe, it, expect } from 'vitest';
import { insights, insightActions } from '../../../src/modules/fabric/demo/insights';

const now = new Date('2026-10-31');
const opts = { seed: 42, now, institutionId: 'inst-001' };

describe('fabric fixtures: insights', () => {
  describe('insights()', () => {
    it('returns exactly 30 insights', () => {
      const result = insights(opts);
      expect(result).toHaveLength(30);
    });

    it('generates deterministic ids starting with "ins-0001"', () => {
      const result = insights(opts);
      expect(result[0].id).toBe('ins-0001');
      expect(result[1].id).toBe('ins-0002');
      expect(result[29].id).toBe('ins-0030');
    });

    it('covers all 7 domains', () => {
      const result = insights(opts);
      const domains = new Set(result.map((i) => i.domain));
      expect(domains.size).toBe(7);
      expect(domains).toContain('attendance');
      expect(domains).toContain('academics');
      expect(domains).toContain('finance');
      expect(domains).toContain('admissions');
      expect(domains).toContain('operations');
      expect(domains).toContain('wellbeing');
      expect(domains).toContain('staff');
    });

    it('covers all 4 kinds', () => {
      const result = insights(opts);
      const kinds = new Set(result.map((i) => i.kind));
      expect(kinds.size).toBe(4);
      expect(kinds).toContain('descriptive');
      expect(kinds).toContain('diagnostic');
      expect(kinds).toContain('predictive');
      expect(kinds).toContain('prescriptive');
    });

    it('has at least 8 with entity_ref', () => {
      const result = insights(opts);
      const withRef = result.filter((i) => i.entity_ref !== null);
      expect(withRef.length).toBeGreaterThanOrEqual(8);
    });

    it('has valid severity values', () => {
      const result = insights(opts);
      const severities = new Set(result.map((i) => i.severity));
      severities.forEach((s) => {
        expect(['info', 'watch', 'warning', 'critical']).toContain(s);
      });
    });

    it('has confidence in range [0.4, 0.95]', () => {
      const result = insights(opts);
      result.forEach((i) => {
        expect(i.confidence).toBeGreaterThanOrEqual(0.4);
        expect(i.confidence).toBeLessThanOrEqual(0.95);
      });
    });

    it('has 2-4 evidence items with units', () => {
      const result = insights(opts);
      result.forEach((i) => {
        expect(i.evidence.length).toBeGreaterThanOrEqual(2);
        expect(i.evidence.length).toBeLessThanOrEqual(4);
        i.evidence.forEach((e) => {
          expect(e.label).toBeTruthy();
          expect(typeof e.value).toBe('number');
          expect(e.unit).toBeTruthy();
        });
      });
    });

    it('has 2-3 sources', () => {
      const result = insights(opts);
      result.forEach((i) => {
        expect(i.sources.length).toBeGreaterThanOrEqual(2);
        expect(i.sources.length).toBeLessThanOrEqual(3);
      });
    });

    it('has factor weights summing ≤ 1', () => {
      const result = insights(opts);
      result.forEach((i) => {
        const sum = i.factors.reduce((acc, f) => acc + f.weight, 0);
        expect(sum).toBeLessThanOrEqual(1.0 + 1e-10);
      });
    });

    it('has 2-3 recommended_actions', () => {
      const result = insights(opts);
      result.forEach((i) => {
        expect(i.recommended_actions.length).toBeGreaterThanOrEqual(2);
        expect(i.recommended_actions.length).toBeLessThanOrEqual(3);
      });
    });

    it('sets approval_required=true only for critical severity', () => {
      const result = insights(opts);
      result.forEach((i) => {
        if (i.severity === 'critical') {
          expect(i.approval_required).toBe(true);
        }
      });
    });

    it('has pattern text ≤300 chars and no causation claims', () => {
      const result = insights(opts);
      result.forEach((i) => {
        expect(i.pattern.length).toBeLessThanOrEqual(300);
        expect(i.pattern).not.toMatch(/causes?|cause|driven by|resulted in|led to|because|due to/i);
      });
    });

    it('produces same output with same seed', () => {
      const result1 = insights(opts);
      const result2 = insights(opts);
      expect(result1).toEqual(result2);
    });

    it('all fields are populated and typed correctly', () => {
      const result = insights(opts);
      const ins = result[0];
      expect(ins.id).toBeTruthy();
      expect(ins.institution_id).toBe(opts.institutionId);
      expect(ins.created_at).toBeTruthy();
      expect(ins.updated_at).toBeTruthy();
      expect(ins.title).toBeTruthy();
      expect(ins.pattern).toBeTruthy();
      expect(ins.date_from).toBeTruthy();
      expect(ins.date_to).toBeTruthy();
      expect(ins.reviewer_role).toBeTruthy();
      expect(ins.status).toBeTruthy();
    });
  });

  describe('insightActions()', () => {
    it('returns exactly 12 actions', () => {
      const result = insightActions(opts);
      expect(result).toHaveLength(12);
    });

    it('generates deterministic ids starting with "iac-0001"', () => {
      const result = insightActions(opts);
      expect(result[0].id).toBe('iac-0001');
      expect(result[11].id).toBe('iac-0012');
    });

    it('has exactly 5 with actual_outcome and measured_at', () => {
      const result = insightActions(opts);
      const withOutcome = result.filter((a) => a.actual_outcome !== null && a.measured_at !== null);
      expect(withOutcome).toHaveLength(5);
    });

    it('every action references an existing insight', () => {
      const allInsights = insights(opts);
      const insightIds = new Set(allInsights.map((i) => i.id));
      const result = insightActions(opts);
      result.forEach((a) => {
        expect(insightIds.has(a.insight_id)).toBe(true);
      });
    });

    it('has valid status values', () => {
      const result = insightActions(opts);
      result.forEach((a) => {
        expect(['planned', 'done', 'measured']).toContain(a.status);
      });
    });

    it('has proper date ordering: decided_at >= measured_at (when present)', () => {
      const result = insightActions(opts);
      result.forEach((a) => {
        if (a.measured_at) {
          const decided = new Date(a.decided_at).getTime();
          const measured = new Date(a.measured_at).getTime();
          expect(measured).toBeGreaterThanOrEqual(decided);
        }
      });
    });

    it('action text ≤300 chars', () => {
      const result = insightActions(opts);
      result.forEach((a) => {
        expect(a.action.length).toBeLessThanOrEqual(300);
        expect(a.rationale.length).toBeLessThanOrEqual(300);
        expect(a.expected_outcome.length).toBeLessThanOrEqual(300);
      });
    });

    it('produces same output with same seed', () => {
      const result1 = insightActions(opts);
      const result2 = insightActions(opts);
      expect(result1).toEqual(result2);
    });

    it('all fields are populated and typed correctly', () => {
      const result = insightActions(opts);
      const act = result[0];
      expect(act.id).toBeTruthy();
      expect(act.institution_id).toBe(opts.institutionId);
      expect(act.created_at).toBeTruthy();
      expect(act.insight_id).toBeTruthy();
      expect(act.action).toBeTruthy();
      expect(act.owner).toBeTruthy();
      expect(act.rationale).toBeTruthy();
      expect(act.expected_outcome).toBeTruthy();
      expect(act.decided_at).toBeTruthy();
    });
  });
});
