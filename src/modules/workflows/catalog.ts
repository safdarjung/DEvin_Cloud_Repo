// Workflow catalog: events, metrics, roles, operators. No imports (seed/jobs run under plain node).

export const WORKFLOW_ENGINE_VERSION = 'workflows_v1' as const

// Events: closed set from rulings (T1 §Events)
export const WORKFLOW_EVENTS = {
  'attendance.absences_submitted': { label: 'Absences submitted', module: 'attendance' },
  'results.published': { label: 'Results published', module: 'exams' },
  'enquiry.received': { label: 'Enquiry received', module: 'admissions' },
} as const

export type WorkflowEventKey = keyof typeof WORKFLOW_EVENTS

// Metrics: closed set from rulings (T1 §Metrics)
export const WORKFLOW_METRICS = {
  'attendance.session_absences': {
    label: 'Absent students in session',
    module: 'attendance',
    event: 'attendance.absences_submitted',
  },
  'attendance.repeat_absentees': {
    label: 'Students absent 3+ sessions',
    module: 'attendance',
    event: 'attendance.absences_submitted',
  },
  'assignments.missing_due_tomorrow': {
    label: 'Missing submissions due tomorrow',
    module: 'assignments',
    event: null,
  },
  'exams.papers_next_7_days': {
    label: 'Exam papers in next 7 days',
    module: 'exams',
    event: null,
  },
  'finance.overdue_invoices': {
    label: 'Overdue invoices',
    module: 'finance_plus',
    event: null,
  },
  'admissions.stale_enquiries': {
    label: 'Stale admission enquiries',
    module: 'admissions',
    event: null,
  },
} as const

export type WorkflowMetricKey = keyof typeof WORKFLOW_METRICS

// Notify audience roles (rulings §Actions, `notify` config)
export const NOTIFY_ROLES = ['owner', 'principal', 'admin', 'teacher', 'accountant', 'admissions', 'exam_controller'] as const

// Condition operators (rulings §Graph rules 3, condition config)
export const CONDITION_OPS = ['gt', 'gte', 'lt', 'lte', 'eq'] as const

// Node config → module mapping (rulings §Engine Ports)
export const NODE_MODULE = {
  fee_defaulters: 'finance_plus',
  report: 'scheduled_reports',
  agent: 'agents',
} as const
