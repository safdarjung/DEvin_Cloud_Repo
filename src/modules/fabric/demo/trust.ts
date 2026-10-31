import { addDays, FixtureOpts, isoDate, rng } from './prng';
import type {
  AuditEventRow,
  ConsentRecord,
  ModelRegistryEntry,
  PermissionReview,
} from '../types';
import { INDIAN_FIRST_NAMES, INDIAN_LAST_NAMES } from './prng';
import type { Role } from '@/lib/auth/permissions';

const ROLES: Role[] = [
  'owner',
  'principal',
  'admin',
  'admissions',
  'accountant',
  'exam_controller',
  'teacher',
  'student',
];

const AUDIT_EVENTS = [
  'exam.result.publish',
  'finance.receipt.create',
  'finance.payment.record',
  'membership.role.change',
  'ai.generate',
  'ai.usage.read',
  'student.write',
  'staff.write',
  'academics.manage',
  'assignment.manage',
];

const ENTITIES = ['exam', 'finance', 'member', 'student', 'staff', 'assignment'];

const CONSENT_SUBJECTS = [
  'Data processing for analytics',
  'AI-powered insights',
  'Email communications',
  'SMS notifications',
  'Location tracking',
  'Performance monitoring',
  'Third-party integration',
  'Marketing research',
  'Cloud backup',
  'API usage',
];

const CONSENT_PURPOSES = [
  'Operational necessity',
  'Service improvement',
  'Regulatory compliance',
  'User preference',
  'Institutional policy',
  'Research',
  'Audit trail',
];

export function auditEvents(opts: FixtureOpts): AuditEventRow[] {
  const g = rng(opts.seed ?? 7);
  const events: AuditEventRow[] = [];

  for (let i = 0; i < 40; i++) {
    const daysAgo = g.int(0, 9);
    const at = addDays(opts.now, -daysAgo);

    events.push({
      id: g.id('audit', i),
      institution_id: opts.institutionId,
      actor: `${g.pick(INDIAN_FIRST_NAMES)} ${g.pick(INDIAN_LAST_NAMES)}`,
      actor_role: g.pick(ROLES),
      event: g.pick(AUDIT_EVENTS),
      entity: g.pick(ENTITIES),
      entity_id: g.id('ent', i),
      at: isoDate(at),
      summary: `Event ${i + 1} logged at ${isoDate(at)}`,
    });
  }

  // Sort descending by date
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function modelRegistry(opts: FixtureOpts): ModelRegistryEntry[] {
  const g = rng((opts.seed ?? 7) + 1);

  return [
    {
      id: g.id('model', 0),
      provider: 'Ollama',
      model: 'qwen:7b',
      tier: 'local',
      version: '1.0.0',
      cost_per_1k_in_paise: 0,
      cost_per_1k_out_paise: 0,
      latency_ms_p50: 245,
      eval_score: 0.82,
      status: 'active',
    },
    {
      id: g.id('model', 1),
      provider: 'Google',
      model: 'gemini-1.5-flash',
      tier: 'cloud',
      version: '1.5',
      cost_per_1k_in_paise: 8,
      cost_per_1k_out_paise: 32,
      latency_ms_p50: 890,
      eval_score: 0.91,
      status: 'fallback',
    },
    {
      id: g.id('model', 2),
      provider: 'Groq',
      model: 'llama2-70b-4096',
      tier: 'cloud',
      version: '2.0',
      cost_per_1k_in_paise: 12,
      cost_per_1k_out_paise: 45,
      latency_ms_p50: 120,
      eval_score: 0.88,
      status: 'active',
    },
    {
      id: g.id('model', 3),
      provider: 'Anthropic',
      model: 'claude-3-haiku',
      tier: 'cloud',
      version: '3.0',
      cost_per_1k_in_paise: 25,
      cost_per_1k_out_paise: 125,
      latency_ms_p50: 650,
      eval_score: 0.94,
      status: 'active',
    },
    {
      id: g.id('model', 4),
      provider: 'Laya',
      model: 'classifier-v2',
      tier: 'local',
      version: '2.1',
      cost_per_1k_in_paise: 0,
      cost_per_1k_out_paise: 0,
      latency_ms_p50: 85,
      eval_score: 0.79,
      status: 'active',
    },
    {
      id: g.id('model', 5),
      provider: 'OpenAI',
      model: 'gpt-4-turbo',
      tier: 'cloud',
      version: '4.0',
      cost_per_1k_in_paise: 300,
      cost_per_1k_out_paise: 600,
      latency_ms_p50: 1200,
      eval_score: null,
      status: 'retired',
    },
  ];
}

export function consentRecords(opts: FixtureOpts): ConsentRecord[] {
  const g = rng((opts.seed ?? 7) + 2);
  const records: ConsentRecord[] = [];

  for (let i = 0; i < 10; i++) {
    const granted = g.chance(0.7);
    const expiresIn = granted ? g.int(30, 365) : null;
    const expiresAt = expiresIn ? isoDate(addDays(opts.now, expiresIn)) : null;
    const daysAgo = g.int(0, 60);

    records.push({
      id: g.id('consent', i),
      user_label: `${g.pick(INDIAN_FIRST_NAMES)} ${g.pick(INDIAN_LAST_NAMES)}`,
      subject: g.pick(CONSENT_SUBJECTS),
      purpose: g.pick(CONSENT_PURPOSES),
      granted,
      at: isoDate(addDays(opts.now, -daysAgo)),
      expires_at: expiresAt,
    });
  }

  return records;
}

export function permissionReviews(opts: FixtureOpts): PermissionReview[] {
  const g = rng((opts.seed ?? 7) + 3);
  const reviews: PermissionReview[] = [];

  for (let i = 0; i < 12; i++) {
    const statusIdx = g.int(0, 2);
    const statuses: Array<'due' | 'reviewed' | 'revoked'> = [
      'due',
      'reviewed',
      'revoked',
    ];
    const status = statuses[statusIdx]!;

    const lastReviewedDaysAgo =
      status === 'due' ? null : g.int(1, 90);
    const lastReviewed = lastReviewedDaysAgo
      ? isoDate(addDays(opts.now, -lastReviewedDaysAgo))
      : null;

    const dueDaysFromNow = g.int(1, 180);

    reviews.push({
      id: g.id('review', i),
      member: `${g.pick(INDIAN_FIRST_NAMES)} ${g.pick(INDIAN_LAST_NAMES)}`,
      role: g.pick(ROLES),
      extra_permissions: g.chance(0.3)
        ? [g.pick(['audit.read', 'ai.usage.read', 'notification.log.read'])]
        : [],
      last_reviewed: lastReviewed,
      due: isoDate(addDays(opts.now, dueDaysFromNow)),
      status,
    });
  }

  return reviews;
}
