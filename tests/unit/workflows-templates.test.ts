// M23-T9 Tests for seeded workflow templates.
import { describe, it, expect } from 'vitest'
import { WORKFLOW_TEMPLATES } from '../../src/modules/workflows/templates'
import { parseGraph, triggerColumns } from '../../src/modules/workflows/graph'

describe('WORKFLOW_TEMPLATES', () => {
  it('has exactly 5 templates', () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(5)
  })

  it('has unique keys', () => {
    const keys = WORKFLOW_TEMPLATES.map((t) => t.key)
    expect(keys).toEqual([...new Set(keys)])
  })

  it('has unique names', () => {
    const names = WORKFLOW_TEMPLATES.map((t) => t.name)
    expect(names).toEqual([...new Set(names)])
  })

  describe('each template', () => {
    WORKFLOW_TEMPLATES.forEach((template) => {
      describe(template.key, () => {
        it('parses successfully', () => {
          const result = parseGraph({
            nodes: template.nodes,
            edges: template.edges,
          })
          expect(result.ok).toBe(true)
          if (!result.ok) throw new Error(`Parse failed: ${result.errors.join(', ')}`)
          expect(result.ok && result.graph).toBeDefined()
        })

        it('has all notify messages ≤ 200 chars', () => {
          const notifyNodes = template.nodes.filter((n) => n.type === 'notify')
          for (const node of notifyNodes) {
            if ('message' in node.config) {
              expect(node.config.message.length).toBeLessThanOrEqual(200)
            }
          }
        })
      })
    })

    it('absence_follow_up has event trigger', () => {
      const template = WORKFLOW_TEMPLATES[0]
      expect(template.key).toBe('absence_follow_up')
      const result = parseGraph({ nodes: template.nodes, edges: template.edges })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Parse failed')
      const cols = triggerColumns(result.graph)
      expect(cols.trigger_type).toBe('event')
      expect(cols.trigger_config).toBe('attendance.absences_submitted')
    })

    it('assignment_reminder has schedule trigger (0 16 * * 1-6)', () => {
      const template = WORKFLOW_TEMPLATES[1]
      expect(template.key).toBe('assignment_reminder')
      const result = parseGraph({ nodes: template.nodes, edges: template.edges })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Parse failed')
      const cols = triggerColumns(result.graph)
      expect(cols.trigger_type).toBe('schedule')
      expect(cols.trigger_config).toBe('0 16 * * 1-6')
    })

    it('exam_reminder has schedule trigger (0 8 * * 1)', () => {
      const template = WORKFLOW_TEMPLATES[2]
      expect(template.key).toBe('exam_reminder')
      const result = parseGraph({ nodes: template.nodes, edges: template.edges })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Parse failed')
      const cols = triggerColumns(result.graph)
      expect(cols.trigger_type).toBe('schedule')
      expect(cols.trigger_config).toBe('0 8 * * 1')
    })

    it('fee_reminder has schedule trigger (0 9 * * 1)', () => {
      const template = WORKFLOW_TEMPLATES[3]
      expect(template.key).toBe('fee_reminder')
      const result = parseGraph({ nodes: template.nodes, edges: template.edges })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Parse failed')
      const cols = triggerColumns(result.graph)
      expect(cols.trigger_type).toBe('schedule')
      expect(cols.trigger_config).toBe('0 9 * * 1')
    })

    it('admissions_follow_up has schedule trigger (0 10 * * 1-6)', () => {
      const template = WORKFLOW_TEMPLATES[4]
      expect(template.key).toBe('admissions_follow_up')
      const result = parseGraph({ nodes: template.nodes, edges: template.edges })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Parse failed')
      const cols = triggerColumns(result.graph)
      expect(cols.trigger_type).toBe('schedule')
      expect(cols.trigger_config).toBe('0 10 * * 1-6')
    })

    it('only fee_reminder has an approval node', () => {
      const approvalCounts = WORKFLOW_TEMPLATES.map((t) => t.nodes.filter((n) => n.type === 'approval').length)
      expect(approvalCounts).toEqual([0, 0, 0, 1, 0])
    })

    it('only fee_reminder has a fee_defaulters notify node', () => {
      const hasFeeDefaulters = WORKFLOW_TEMPLATES.map((t) =>
        t.nodes.some((n) => n.type === 'notify' && 'audience' in n.config && n.config.audience === 'fee_defaulters')
      )
      expect(hasFeeDefaulters).toEqual([false, false, false, true, false])
    })

    it('only admissions_follow_up has an agent node', () => {
      const agentCounts = WORKFLOW_TEMPLATES.map((t) => t.nodes.filter((n) => n.type === 'agent').length)
      expect(agentCounts).toEqual([0, 0, 0, 0, 1])
    })

    it('admissions_follow_up agent uses admissions slug', () => {
      const template = WORKFLOW_TEMPLATES[4]
      const agentNode = template.nodes.find((n) => n.type === 'agent')
      expect(agentNode).toBeDefined()
      if (agentNode && 'config' in agentNode) {
        expect('agent' in agentNode.config && agentNode.config.agent).toBe('admissions')
      }
    })
  })
})
