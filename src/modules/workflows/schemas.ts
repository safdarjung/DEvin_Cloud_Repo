// M23-T5 Zod schemas for workflow.* actions and queries. Relative .ts imports (seed-safe).
import { z } from 'zod'
import { uuid } from '../../lib/schemas/common.ts'
import { CronSchema } from '../reports/schemas.ts'

// Re-export for convenience
export { CronSchema }

export const WORKFLOW_ENGINE_VERSION = 'workflows_v1' as const

// Events, metrics, roles from catalog (relative import unsafe here; enum via schemas instead)
export const WORKFLOW_EVENTS = {
  'attendance.absences_submitted': { label: 'Absences submitted', module: 'attendance' },
  'results.published': { label: 'Results published', module: 'exams' },
  'enquiry.received': { label: 'Enquiry received', module: 'admissions' },
} as const

export type WorkflowEventKey = keyof typeof WORKFLOW_EVENTS

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

export const NOTIFY_ROLES = ['owner', 'principal', 'admin', 'teacher', 'accountant', 'admissions', 'exam_controller'] as const

export const CONDITION_OPS = ['gt', 'gte', 'lt', 'lte', 'eq'] as const

export const NODE_MODULE = {
  fee_defaulters: 'finance_plus',
  report: 'scheduled_reports',
  agent: 'agents',
} as const

// Node config values are strings (from UI/graph JSON)
export const WorkflowNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Node ID must match pattern'),
  type: z.enum(['trigger', 'condition', 'notify', 'report', 'agent', 'approval', 'end', 'tool']),
  label: z.string().min(1).max(60),
  config: z.record(z.string(), z.string().max(500)),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
})

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  label: z.enum(['true', 'false', 'approved', 'rejected']).optional(),
})

export type GraphEdge = z.infer<typeof GraphEdgeSchema>

export const WorkflowSaveSchema = z
  .object({
    id: uuid.optional(),
    name: z.string().trim().min(1).max(80),
    nodes: z.array(WorkflowNodeSchema).min(2).max(30),
    edges: z.array(GraphEdgeSchema).min(1).max(60),
  })
  .strict()

export type WorkflowSaveInput = z.infer<typeof WorkflowSaveSchema>

export const WorkflowStatusSchema = z
  .object({
    id: uuid,
    status: z.enum(['draft', 'active', 'paused', 'disabled']),
  })
  .strict()

export type WorkflowStatusInput = z.infer<typeof WorkflowStatusSchema>

export const WorkflowRunNowSchema = z
  .object({
    id: uuid,
  })
  .strict()

export type WorkflowRunNowInput = z.infer<typeof WorkflowRunNowSchema>

export const WorkflowDecideSchema = z
  .object({
    runId: uuid,
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(500).optional(),
  })
  .strict()

export type WorkflowDecideInput = z.infer<typeof WorkflowDecideSchema>

export const WorkflowListSchema = z
  .object({
    status: z.enum(['draft', 'active', 'paused', 'disabled']).optional(),
  })
  .strict()

export type WorkflowListInput = z.infer<typeof WorkflowListSchema>

export const WorkflowRunsSchema = z
  .object({
    workflowId: uuid.optional(),
    status: z.enum(['running', 'awaiting_approval', 'done', 'failed']).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()

export type WorkflowRunsInput = z.infer<typeof WorkflowRunsSchema>

export const WorkflowRunJobPayloadSchema = z
  .object({
    run_id: uuid,
  })
  .strict()

export type WorkflowRunJobPayload = z.infer<typeof WorkflowRunJobPayloadSchema>
