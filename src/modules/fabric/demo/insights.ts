import { Insight, InsightAction } from '../types';
import { rng, isoDate, addDays, INDIAN_FIRST_NAMES, INDIAN_LAST_NAMES, SECTION_LABELS, FixtureOpts } from './prng';

const DOMAINS = ['attendance', 'academics', 'finance', 'admissions', 'operations', 'wellbeing', 'staff'] as const;
const KINDS = ['descriptive', 'diagnostic', 'predictive', 'prescriptive'] as const;
const SEVERITIES = ['info', 'watch', 'warning', 'critical'] as const;
const REVIEWER_ROLES = ['head_of_academics', 'finance_coordinator', 'principal', 'counsellor', 'operations_manager'];
const SOURCES = ['attendance_marks', 'assessment_results', 'financial_records', 'enrollment_data', 'health_records', 'staff_feedback'];
const EVIDENCE_LABELS = {
  attendance: ['absent_days', 'late_count', 'absence_rate'],
  academics: ['average_score', 'failing_students', 'mastery_percentage'],
  finance: ['outstanding_amount', 'late_payment_count', 'collection_rate'],
  admissions: ['applications_received', 'conversion_rate', 'dropout_count'],
  operations: ['room_utilization', 'timetable_conflicts', 'staff_workload_hours'],
  wellbeing: ['counselling_sessions', 'concern_flags', 'incident_count'],
  staff: ['absent_days', 'training_hours', 'performance_score'],
};
const ENTITY_TYPES = ['section', 'student', 'staff', 'route', 'fee_structure', 'department'] as const;

export function insights(opts: FixtureOpts): Insight[] {
  const r = rng(opts.seed);
  const result: Insight[] = [];
  let domainIdx = 0;
  let kindIdx = 0;
  let entityRefCount = 0;

  for (let i = 0; i < 30; i++) {
    // Cycle through all domains and kinds
    const domain = DOMAINS[domainIdx % DOMAINS.length];
    const kind = KINDS[kindIdx % KINDS.length];
    if (kindIdx === KINDS.length - 1) domainIdx++;
    kindIdx = (kindIdx + 1) % KINDS.length;

    const severity = SEVERITIES[r.int(0, SEVERITIES.length - 1)];
    const daysBack = r.int(7, 60);
    const dateFrom = isoDate(addDays(opts.now, -daysBack));
    const dateTo = isoDate(addDays(opts.now, -r.int(0, 5)));

    // ≥8 with entity_ref
    let entity_ref = null;
    if (entityRefCount < 8 || (entityRefCount < 12 && r.chance(0.5))) {
      const entityType = ENTITY_TYPES[r.int(0, ENTITY_TYPES.length - 1)];
      let id: string;
      let label: string;

      if (entityType === 'section') {
        label = r.pick(SECTION_LABELS);
        id = `sec-${label.replace('-', '')}`;
      } else if (entityType === 'student') {
        const fname = r.pick(INDIAN_FIRST_NAMES);
        const lname = r.pick(INDIAN_LAST_NAMES);
        label = `${fname} ${lname}`;
        id = `std-${String(i).padStart(4, '0')}`;
      } else if (entityType === 'staff') {
        const fname = r.pick(INDIAN_FIRST_NAMES);
        const lname = r.pick(INDIAN_LAST_NAMES);
        label = `${fname} ${lname}`;
        id = `stf-${String(i).padStart(4, '0')}`;
      } else if (entityType === 'route') {
        label = `Route ${r.int(1, 5)}`;
        id = `rte-${String(r.int(1, 5)).padStart(3, '0')}`;
      } else if (entityType === 'fee_structure') {
        const amounts = ['₹5000-10000', '₹10000-20000', '₹20000-50000'];
        label = amounts[r.int(0, amounts.length - 1)];
        id = `fee-${String(i).padStart(4, '0')}`;
      } else {
        label = 'General';
        id = `dept-${String(i).padStart(3, '0')}`;
      }

      entity_ref = { type: entityType, id, label };
      entityRefCount++;
    }

    // Evidence: 2-4 rows with units
    const evidenceCount = r.int(2, 4);
    const evidence = [];
    const labels = EVIDENCE_LABELS[domain] || ['value'];
    for (let j = 0; j < evidenceCount; j++) {
      const unit = r.pick(['%', 'count', 'hours', '₹', 'days']);
      evidence.push({
        label: labels[j % labels.length],
        value: r.int(10, 250),
        unit,
      });
    }

    // Sources: 2-3 like "attendance_marks"
    const sourceCount = r.int(2, 3);
    const sources = [];
    for (let j = 0; j < sourceCount; j++) {
      sources.push(r.pick(SOURCES));
    }

    // Factors: weights sum ≤ 1
    const factorCount = r.int(2, 4);
    const factors = [];
    let totalWeight = 0;
    for (let j = 0; j < factorCount - 1; j++) {
      const w = Math.min(0.3, r.next() * 0.4);
      factors.push({ label: `Factor ${j + 1}`, weight: w });
      totalWeight += w;
    }
    const lastWeight = Math.max(0, Math.min(1 - totalWeight, r.next() * 0.3));
    factors.push({ label: `Factor ${factorCount}`, weight: lastWeight });

    const confidence = 0.4 + r.next() * 0.55;
    const recommendedActions = [];
    const actionCount = r.int(2, 3);
    const actionTemplates = [
      'Review with relevant staff',
      'Schedule follow-up meeting',
      'Implement monitoring plan',
      'Send communication to stakeholders',
      'Increase supervision',
      'Adjust timetable',
    ];
    for (let j = 0; j < actionCount; j++) {
      recommendedActions.push(r.pick(actionTemplates));
    }

    const patternTemplates = [
      `Associated with ${domain} challenges in recent period.`,
      `Pattern shows ${severity === 'critical' ? 'significant' : 'notable'} variation from baseline.`,
      `Observed trend aligns with seasonal factors affecting ${domain}.`,
      `Data suggests emerging issue requiring monitoring and intervention.`,
      `Correlates with changes in institutional operations and ${domain} practices.`,
    ];

    result.push({
      id: r.id('ins', i + 1),
      institution_id: opts.institutionId,
      created_at: isoDate(new Date()),
      updated_at: isoDate(new Date()),
      title: `${domain.charAt(0).toUpperCase() + domain.slice(1)} ${kind} insight #${i + 1}`,
      domain: domain,
      severity: severity,
      kind: kind,
      pattern: r.pick(patternTemplates),
      evidence: evidence,
      sources: sources,
      date_from: dateFrom,
      date_to: dateTo,
      confidence: Math.min(0.95, Math.max(0.4, confidence)),
      factors: factors,
      reviewer_role: r.pick(REVIEWER_ROLES),
      recommended_actions: recommendedActions,
      approval_required: severity === 'critical',
      status: r.pick(['new', 'reviewing', 'actioned', 'resolved'] as const),
      entity_ref: entity_ref,
    });
  }

  return result;
}

export function insightActions(opts: FixtureOpts): InsightAction[] {
  const r = rng((opts.seed ?? 7) + 1000);
  const allInsights = insights(opts);
  const result: InsightAction[] = [];
  const ownerNames = INDIAN_FIRST_NAMES.map((f, i) => `${f} ${INDIAN_LAST_NAMES[i % INDIAN_LAST_NAMES.length]}`);
  const actionTemplates = [
    'Schedule meeting with stakeholders',
    'Review policy and procedures',
    'Implement corrective measures',
    'Monitor key metrics weekly',
    'Provide additional support',
    'Update communication protocols',
    'Conduct training session',
    'Audit current processes',
    'Initiate pilot program',
    'Document recommendations',
  ];

  let withOutcome = 0;
  for (let i = 0; i < 12; i++) {
    const insight = allInsights[r.int(0, allInsights.length - 1)];
    const hasOutcome = withOutcome < 5 && (i < 4 || r.chance(0.5));

    const decidedDaysBack = r.int(5, 30);
    const decidedAt = isoDate(addDays(opts.now, -decidedDaysBack));
    const measuredAt = hasOutcome ? isoDate(addDays(opts.now, -r.int(1, 4))) : null;

    result.push({
      id: r.id('iac', i + 1),
      institution_id: opts.institutionId,
      created_at: isoDate(new Date()),
      updated_at: isoDate(new Date()),
      insight_id: insight.id,
      action: `${r.pick(actionTemplates)} (${insight.domain})`,
      owner: r.pick(ownerNames),
      rationale: `Addressing ${insight.domain} concern identified in insight ${insight.id}.`,
      expected_outcome: `Improve ${insight.domain} metrics by 15-20% within 30 days.`,
      actual_outcome: hasOutcome ? `Achieved 18% improvement in key metric.` : null,
      decided_at: decidedAt,
      measured_at: measuredAt,
      status: hasOutcome ? 'measured' : r.pick(['planned', 'done'] as const),
    });

    if (hasOutcome) withOutcome++;
  }

  return result;
}
