import { describe, it, expect } from 'vitest';
import {
  auditEvents,
  consentRecords,
  modelRegistry,
  permissionReviews,
} from '@/modules/fabric/demo/trust';

describe('fabric fixtures: trust', () => {
  const now = new Date('2026-10-31');
  const institutionId = 'inst-0001';

  describe('auditEvents', () => {
    it('returns 40 events', () => {
      const events = auditEvents({ now, institutionId });
      expect(events).toHaveLength(40);
    });

    it('is sorted descending by at', () => {
      const events = auditEvents({ now, institutionId });
      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i]!.at >= events[i + 1]!.at).toBe(true);
      }
    });

    it('same seed produces same output', () => {
      const opts = { seed: 42, now, institutionId };
      const first = auditEvents(opts);
      const second = auditEvents(opts);
      expect(first).toEqual(second);
    });

    it('all strings are <= 200 chars', () => {
      const events = auditEvents({ now, institutionId });
      for (const evt of events) {
        expect(evt.actor.length).toBeLessThanOrEqual(200);
        expect(evt.actor_role.length).toBeLessThanOrEqual(200);
        expect(evt.event.length).toBeLessThanOrEqual(200);
        expect(evt.entity.length).toBeLessThanOrEqual(200);
        expect(evt.summary.length).toBeLessThanOrEqual(200);
      }
    });

    it('each event has required fields', () => {
      const events = auditEvents({ now, institutionId });
      for (const evt of events) {
        expect(evt.id).toBeTruthy();
        expect(evt.institution_id).toBe(institutionId);
        expect(evt.actor).toBeTruthy();
        expect(evt.actor_role).toBeTruthy();
        expect(evt.event).toBeTruthy();
        expect(evt.entity).toBeTruthy();
        expect(evt.entity_id).toBeTruthy();
        expect(evt.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(evt.summary).toBeTruthy();
      }
    });
  });

  describe('modelRegistry', () => {
    it('returns 6 models', () => {
      const models = modelRegistry({ now, institutionId });
      expect(models).toHaveLength(6);
    });

    it('same seed produces same output', () => {
      const opts = { seed: 42, now, institutionId };
      const first = modelRegistry(opts);
      const second = modelRegistry(opts);
      expect(first).toEqual(second);
    });

    it('has local and cloud tiers', () => {
      const models = modelRegistry({ now, institutionId });
      const tiers = new Set(models.map((m) => m.tier));
      expect(tiers.has('local')).toBe(true);
      expect(tiers.has('cloud')).toBe(true);
    });

    it('has active, fallback, and retired statuses', () => {
      const models = modelRegistry({ now, institutionId });
      const statuses = new Set(models.map((m) => m.status));
      expect(statuses.size).toBeGreaterThanOrEqual(2);
      expect(Array.from(statuses)).toContain('active');
    });

    it('all strings are <= 200 chars', () => {
      const models = modelRegistry({ now, institutionId });
      for (const m of models) {
        expect(m.provider.length).toBeLessThanOrEqual(200);
        expect(m.model.length).toBeLessThanOrEqual(200);
        expect(m.version.length).toBeLessThanOrEqual(200);
      }
    });
  });

  describe('consentRecords', () => {
    it('returns 10 records', () => {
      const records = consentRecords({ now, institutionId });
      expect(records).toHaveLength(10);
    });

    it('same seed produces same output', () => {
      const opts = { seed: 42, now, institutionId };
      const first = consentRecords(opts);
      const second = consentRecords(opts);
      expect(first).toEqual(second);
    });

    it('has granted and not granted records', () => {
      const records = consentRecords({ now, institutionId });
      const granted = records.filter((r) => r.granted).length;
      const notGranted = records.filter((r) => !r.granted).length;
      expect(granted).toBeGreaterThan(0);
      expect(notGranted).toBeGreaterThan(0);
    });

    it('all strings are <= 200 chars', () => {
      const records = consentRecords({ now, institutionId });
      for (const r of records) {
        expect(r.user_label.length).toBeLessThanOrEqual(200);
        expect(r.subject.length).toBeLessThanOrEqual(200);
        expect(r.purpose.length).toBeLessThanOrEqual(200);
      }
    });

    it('expires_at is null or ISO date', () => {
      const records = consentRecords({ now, institutionId });
      for (const r of records) {
        if (r.expires_at) {
          expect(r.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    });
  });

  describe('permissionReviews', () => {
    it('returns 12 records', () => {
      const reviews = permissionReviews({ now, institutionId });
      expect(reviews).toHaveLength(12);
    });

    it('same seed produces same output', () => {
      const opts = { seed: 42, now, institutionId };
      const first = permissionReviews(opts);
      const second = permissionReviews(opts);
      expect(first).toEqual(second);
    });

    it('statuses include due, reviewed, and revoked', () => {
      const reviews = permissionReviews({ now, institutionId });
      const statuses = new Set(reviews.map((r) => r.status));
      expect(statuses.size).toBeGreaterThanOrEqual(1);
    });

    it('due status has null last_reviewed', () => {
      const reviews = permissionReviews({ now, institutionId });
      const dueReviews = reviews.filter((r) => r.status === 'due');
      for (const r of dueReviews) {
        expect(r.last_reviewed).toBeNull();
      }
    });

    it('reviewed/revoked statuses have last_reviewed', () => {
      const reviews = permissionReviews({ now, institutionId });
      const reviewedReviews = reviews.filter((r) => r.status !== 'due');
      for (const r of reviewedReviews) {
        expect(r.last_reviewed).not.toBeNull();
      }
    });

    it('all strings are <= 200 chars', () => {
      const reviews = permissionReviews({ now, institutionId });
      for (const r of reviews) {
        expect(r.member.length).toBeLessThanOrEqual(200);
        expect(r.role.length).toBeLessThanOrEqual(200);
        for (const perm of r.extra_permissions) {
          expect(perm.length).toBeLessThanOrEqual(200);
        }
      }
    });
  });
});
