import { describe, it, expect } from 'vitest'
import {
  WORKFLOW_ENGINE_VERSION,
  WORKFLOW_EVENTS,
  WORKFLOW_METRICS,
  NOTIFY_ROLES,
  CONDITION_OPS,
  NODE_MODULE,
  WorkflowNodeSchema,
  GraphEdgeSchema,
  WorkflowSaveSchema,
  WorkflowStatusSchema,
  WorkflowRunNowSchema,
  WorkflowDecideSchema,
  WorkflowListSchema,
  WorkflowRunsSchema,
  WorkflowRunJobPayloadSchema,
} from '../../src/modules/workflows/schemas.ts'
import { MODULE_KEYS } from '../../src/lib/modules/catalog.ts'

describe('Workflow Catalog & Schemas', () => {
  describe('Catalog constants', () => {
    it('defines WORKFLOW_ENGINE_VERSION as workflows_v1', () => {
      expect(WORKFLOW_ENGINE_VERSION).toBe('workflows_v1')
    })

    it('exports 3 workflow events', () => {
      const keys = Object.keys(WORKFLOW_EVENTS)
      expect(keys).toHaveLength(3)
      expect(keys).toContain('attendance.absences_submitted')
      expect(keys).toContain('results.published')
      expect(keys).toContain('enquiry.received')
    })

    it('all workflow events have valid module keys', () => {
      for (const [, event] of Object.entries(WORKFLOW_EVENTS)) {
        expect(MODULE_KEYS).toContain(event.module)
      }
    })

    it('exports 6 workflow metrics', () => {
      expect(Object.keys(WORKFLOW_METRICS)).toHaveLength(6)
    })

    it('all metrics have valid module keys and event references', () => {
      for (const [, metric] of Object.entries(WORKFLOW_METRICS)) {
        expect(MODULE_KEYS).toContain(metric.module)
        if (metric.event !== null) {
          expect(WORKFLOW_EVENTS).toHaveProperty(metric.event)
        }
      }
    })

    it('exports 7 notify roles', () => {
      expect(NOTIFY_ROLES).toHaveLength(7)
      const roles = NOTIFY_ROLES as readonly string[]
      expect(roles).toContain('owner')
      expect(roles).toContain('principal')
      expect(roles).toContain('admin')
      expect(roles).toContain('teacher')
      expect(roles).toContain('accountant')
      expect(roles).toContain('admissions')
      expect(roles).toContain('exam_controller')
    })

    it('exports condition operators as expected', () => {
      expect(CONDITION_OPS).toEqual(['gt', 'gte', 'lt', 'lte', 'eq'])
    })

    it('NODE_MODULE maps node types to valid modules', () => {
      for (const [, mod] of Object.entries(NODE_MODULE)) {
        expect(MODULE_KEYS).toContain(mod)
      }
    })

    it('NODE_MODULE has correct mappings', () => {
      expect(NODE_MODULE.fee_defaulters).toBe('finance_plus')
      expect(NODE_MODULE.report).toBe('scheduled_reports')
      expect(NODE_MODULE.agent).toBe('agents')
    })
  })

  describe('WorkflowNodeSchema', () => {
    it('parses valid trigger node', () => {
      const result = WorkflowNodeSchema.safeParse({
        id: 't1',
        type: 'trigger',
        label: 'Start',
        config: { kind: 'schedule', cron: '0 8 * * *' },
        x: 0,
        y: 0,
      })
      expect(result.success).toBe(true)
    })

    it('rejects node id with invalid format', () => {
      const result = WorkflowNodeSchema.safeParse({
        id: 'A1',
        type: 'trigger',
        label: 'Start',
        config: {},
      })
      expect(result.success).toBe(false)
    })

    it('rejects config value exceeding 500 chars', () => {
      const result = WorkflowNodeSchema.safeParse({
        id: 't1',
        type: 'trigger',
        label: 'Start',
        config: { longValue: 'x'.repeat(501) },
      })
      expect(result.success).toBe(false)
    })

    it('accepts tool type for fixture compatibility', () => {
      const result = WorkflowNodeSchema.safeParse({
        id: 'tool1',
        type: 'tool',
        label: 'Old Tool',
        config: {},
      })
      expect(result.success).toBe(true)
    })

    it('accepts supported node types', () => {
      const types = ['trigger', 'condition', 'notify', 'report', 'agent', 'approval', 'end', 'tool']
      for (const type of types) {
        const result = WorkflowNodeSchema.safeParse({
          id: 'n1',
          type,
          label: 'Node',
          config: {},
        })
        expect(result.success).toBe(true)
      }
    })
  })

  describe('GraphEdgeSchema', () => {
    it('parses valid edge without label', () => {
      const result = GraphEdgeSchema.safeParse({
        source: 't1',
        target: 'c1',
      })
      expect(result.success).toBe(true)
    })

    it('parses edge with boolean label', () => {
      const result = GraphEdgeSchema.safeParse({
        source: 'c1',
        target: 'n1',
        label: 'true',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid label value', () => {
      const result = GraphEdgeSchema.safeParse({
        source: 't1',
        target: 'c1',
        label: 'maybe',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('WorkflowSaveSchema', () => {
    it('parses valid workflow save', () => {
      const result = WorkflowSaveSchema.safeParse({
        name: 'Test Workflow',
        nodes: [
          { id: 't1', type: 'trigger', label: 'Start', config: {} },
          { id: 'e1', type: 'end', label: 'End', config: {} },
        ],
        edges: [{ source: 't1', target: 'e1' }],
      })
      expect(result.success).toBe(true)
    })

    it('rejects name with < 1 char', () => {
      const result = WorkflowSaveSchema.safeParse({
        name: '',
        nodes: [
          { id: 't1', type: 'trigger', label: 'Start', config: {} },
          { id: 'e1', type: 'end', label: 'End', config: {} },
        ],
        edges: [{ source: 't1', target: 'e1' }],
      })
      expect(result.success).toBe(false)
    })

    it('rejects name exceeding 80 chars', () => {
      const result = WorkflowSaveSchema.safeParse({
        name: 'x'.repeat(81),
        nodes: [
          { id: 't1', type: 'trigger', label: 'Start', config: {} },
          { id: 'e1', type: 'end', label: 'End', config: {} },
        ],
        edges: [{ source: 't1', target: 'e1' }],
      })
      expect(result.success).toBe(false)
    })

    it('rejects fewer than 2 nodes', () => {
      const result = WorkflowSaveSchema.safeParse({
        name: 'Test',
        nodes: [{ id: 't1', type: 'trigger', label: 'Start', config: {} }],
        edges: [{ source: 't1', target: 't1' }],
      })
      expect(result.success).toBe(false)
    })

    it('rejects more than 30 nodes', () => {
      const nodes = Array.from({ length: 31 }, (_, i) => ({
        id: `n${i}`,
        type: 'end' as const,
        label: `Node ${i}`,
        config: {},
      }))
      const edges = [{ source: 'n0', target: 'n1' }]
      const result = WorkflowSaveSchema.safeParse({
        name: 'Test',
        nodes,
        edges,
      })
      expect(result.success).toBe(false)
    })

    it('rejects fewer than 1 edge', () => {
      const result = WorkflowSaveSchema.safeParse({
        name: 'Test',
        nodes: [
          { id: 't1', type: 'trigger', label: 'Start', config: {} },
          { id: 'e1', type: 'end', label: 'End', config: {} },
        ],
        edges: [],
      })
      expect(result.success).toBe(false)
    })

    it('rejects more than 60 edges', () => {
      const result = WorkflowSaveSchema.safeParse({
        name: 'Test',
        nodes: [
          { id: 't1', type: 'trigger', label: 'Start', config: {} },
          { id: 'e1', type: 'end', label: 'End', config: {} },
        ],
        edges: Array.from({ length: 61 }, (_, i) => ({
          source: 't1',
          target: 'e1',
          label: `edge${i}`,
        })),
      })
      expect(result.success).toBe(false)
    })

    it('allows optional id for new workflows', () => {
      const result = WorkflowSaveSchema.safeParse({
        name: 'New Workflow',
        nodes: [
          { id: 't1', type: 'trigger', label: 'Start', config: {} },
          { id: 'e1', type: 'end', label: 'End', config: {} },
        ],
        edges: [{ source: 't1', target: 'e1' }],
      })
      expect(result.success).toBe(true)
    })

    it('rejects unknown keys', () => {
      const result = WorkflowSaveSchema.safeParse({
        name: 'Test',
        nodes: [
          { id: 't1', type: 'trigger', label: 'Start', config: {} },
          { id: 'e1', type: 'end', label: 'End', config: {} },
        ],
        edges: [{ source: 't1', target: 'e1' }],
        unknownKey: 'value',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('WorkflowStatusSchema', () => {
    it('parses valid status update', () => {
      const result = WorkflowStatusSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'active',
      })
      expect(result.success).toBe(true)
    })

    it('accepts all valid statuses', () => {
      const statuses = ['draft', 'active', 'paused', 'disabled']
      for (const status of statuses) {
        const result = WorkflowStatusSchema.safeParse({
          id: '550e8400-e29b-41d4-a716-446655440000',
          status,
        })
        expect(result.success).toBe(true)
      }
    })

    it('rejects unknown status', () => {
      const result = WorkflowStatusSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'archived',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('WorkflowRunNowSchema', () => {
    it('parses valid run now request', () => {
      const result = WorkflowRunNowSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
      })
      expect(result.success).toBe(true)
    })

    it('rejects non-uuid id', () => {
      const result = WorkflowRunNowSchema.safeParse({
        id: 'not-a-uuid',
      })
      expect(result.success).toBe(false)
    })

    it('rejects unknown keys', () => {
      const result = WorkflowRunNowSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        extra: 'field',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('WorkflowDecideSchema', () => {
    it('parses valid approval decision', () => {
      const result = WorkflowDecideSchema.safeParse({
        runId: '550e8400-e29b-41d4-a716-446655440000',
        decision: 'approve',
      })
      expect(result.success).toBe(true)
    })

    it('parses valid rejection decision', () => {
      const result = WorkflowDecideSchema.safeParse({
        runId: '550e8400-e29b-41d4-a716-446655440000',
        decision: 'reject',
        note: 'Not ready',
      })
      expect(result.success).toBe(true)
    })

    it('rejects decision exceeding 500 chars', () => {
      const result = WorkflowDecideSchema.safeParse({
        runId: '550e8400-e29b-41d4-a716-446655440000',
        decision: 'approve',
        note: 'x'.repeat(501),
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid decision', () => {
      const result = WorkflowDecideSchema.safeParse({
        runId: '550e8400-e29b-41d4-a716-446655440000',
        decision: 'maybe',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('WorkflowListSchema', () => {
    it('parses empty filter', () => {
      const result = WorkflowListSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('parses with status filter', () => {
      const result = WorkflowListSchema.safeParse({ status: 'active' })
      expect(result.success).toBe(true)
    })

    it('rejects invalid status filter', () => {
      const result = WorkflowListSchema.safeParse({ status: 'invalid' })
      expect(result.success).toBe(false)
    })
  })

  describe('WorkflowRunsSchema', () => {
    it('parses minimal request', () => {
      const result = WorkflowRunsSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('defaults limit to 50', () => {
      const result = WorkflowRunsSchema.safeParse({})
      if (result.success) {
        expect(result.data.limit).toBe(50)
      }
    })

    it('rejects limit < 1', () => {
      const result = WorkflowRunsSchema.safeParse({ limit: 0 })
      expect(result.success).toBe(false)
    })

    it('rejects limit > 100', () => {
      const result = WorkflowRunsSchema.safeParse({ limit: 101 })
      expect(result.success).toBe(false)
    })

    it('accepts all valid statuses', () => {
      const statuses = ['running', 'awaiting_approval', 'done', 'failed']
      for (const status of statuses) {
        const result = WorkflowRunsSchema.safeParse({ status })
        expect(result.success).toBe(true)
      }
    })

    it('rejects unknown key', () => {
      const result = WorkflowRunsSchema.safeParse({ unknownKey: 'value' })
      expect(result.success).toBe(false)
    })
  })

  describe('WorkflowRunJobPayloadSchema', () => {
    it('parses valid payload', () => {
      const result = WorkflowRunJobPayloadSchema.safeParse({
        run_id: '550e8400-e29b-41d4-a716-446655440000',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing run_id', () => {
      const result = WorkflowRunJobPayloadSchema.safeParse({})
      expect(result.success).toBe(false)
    })

    it('rejects invalid run_id', () => {
      const result = WorkflowRunJobPayloadSchema.safeParse({
        run_id: 'not-a-uuid',
      })
      expect(result.success).toBe(false)
    })

    it('rejects unknown keys', () => {
      const result = WorkflowRunJobPayloadSchema.safeParse({
        run_id: '550e8400-e29b-41d4-a716-446655440000',
        extra: 'field',
      })
      expect(result.success).toBe(false)
    })
  })
})
