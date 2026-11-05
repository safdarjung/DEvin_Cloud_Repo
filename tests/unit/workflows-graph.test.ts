// M23-T7 — parseGraph / triggerColumns / nextNode (pure, no IO).
import { describe, expect, test } from 'vitest'
import { parseGraph, triggerColumns, nextNode, type ParsedGraph } from '../../src/modules/workflows/graph.ts'

function trigger(config: Record<string, string>) {
  return { id: 't', type: 'trigger', label: 'Start', config }
}
function end(id = 'e') {
  return { id, type: 'end', label: 'End', config: {} }
}

function expectInvalid(nodes: unknown, edges: unknown) {
  const result = parseGraph({ nodes, edges })
  expect(result.ok).toBe(false)
  return result as { ok: false; errors: string[] }
}

describe('parseGraph — valid graphs', () => {
  test('minimal manual trigger -> end is ok', () => {
    const result = parseGraph({
      nodes: [trigger({ kind: 'manual' }), end()],
      edges: [{ source: 't', target: 'e' }],
    })
    expect(result.ok).toBe(true)
  })

  test('the fee-reminder graph from the rulings is ok', () => {
    const nodes = [
      trigger({ kind: 'schedule', cron: '0 9 * * 1' }),
      { id: 'c', type: 'condition', label: 'Overdue?', config: { metric: 'finance.overdue_invoices', op: 'gte', value: '1' } },
      {
        id: 'n1',
        type: 'notify',
        label: 'Alert staff',
        config: { audience: 'roles', roles: 'accountant,principal', message: '{count} invoice(s) overdue.' },
      },
      { id: 'a', type: 'approval', label: 'Approve?', config: { prompt: 'Send fee reminders?' } },
      { id: 'n2', type: 'notify', label: 'Send reminders', config: { audience: 'fee_defaulters' } },
      end(),
    ]
    const edges = [
      { source: 't', target: 'c' },
      { source: 'c', target: 'n1', label: 'true' },
      { source: 'c', target: 'e', label: 'false' },
      { source: 'n1', target: 'a' },
      { source: 'a', target: 'n2', label: 'approved' },
      { source: 'a', target: 'e', label: 'rejected' },
      { source: 'n2', target: 'e' },
    ]
    const result = parseGraph({ nodes, edges })
    expect(result.ok).toBe(true)
  })
})

describe('parseGraph — structure errors', () => {
  test('two triggers is rejected', () => {
    const result = expectInvalid(
      [trigger({ kind: 'manual' }), { ...trigger({ kind: 'manual' }), id: 't2' }, end()],
      [{ source: 't', target: 'e' }, { source: 't2', target: 'e' }],
    )
    expect(result.errors.some((e) => e.includes('only one trigger'))).toBe(true)
  })

  test('trigger with an incoming edge is rejected', () => {
    const result = expectInvalid(
      [trigger({ kind: 'manual' }), end()],
      [{ source: 't', target: 'e' }, { source: 'e', target: 't' }],
    )
    expect(result.errors.some((e) => e.includes('incoming'))).toBe(true)
  })

  test('cycle is rejected', () => {
    const notify = (id: string) => ({
      id,
      type: 'notify',
      label: id,
      config: { audience: 'roles', roles: 'admin', message: 'hi' },
    })
    const result = expectInvalid(
      [trigger({ kind: 'manual' }), notify('n1'), notify('n2')],
      [{ source: 't', target: 'n1' }, { source: 'n1', target: 'n2' }, { source: 'n2', target: 'n1' }],
    )
    expect(result.errors.some((e) => e.includes('cycle'))).toBe(true)
  })

  test('unreachable node is rejected', () => {
    const result = expectInvalid(
      [trigger({ kind: 'manual' }), end('e'), end('x')],
      [{ source: 't', target: 'e' }],
    )
    expect(result.errors.some((e) => e.includes('unreachable'))).toBe(true)
  })

  test('no end node is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'manual' }),
        { id: 'c', type: 'condition', label: 'C', config: { metric: 'assignments.missing_due_tomorrow', op: 'gte', value: '1' } },
      ],
      [{ source: 't', target: 'c' }],
    )
    expect(result.errors.some((e) => e.includes('end node'))).toBe(true)
  })

  test('duplicate node id is rejected', () => {
    const result = expectInvalid(
      [trigger({ kind: 'manual' }), { ...end('e'), id: 't' }],
      [{ source: 't', target: 't2' }],
    )
    expect(result.errors.some((e) => e.includes('duplicate node id'))).toBe(true)
  })

  test('tool node is rejected', () => {
    const result = expectInvalid(
      [trigger({ kind: 'manual' }), { id: 'x', type: 'tool', label: 'X', config: {} }, end()],
      [{ source: 't', target: 'x' }, { source: 'x', target: 'e' }],
    )
    expect(result.errors.some((e) => e.includes('not supported'))).toBe(true)
  })
})

describe('parseGraph — node config errors', () => {
  test('condition without a true edge is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'manual' }),
        { id: 'c', type: 'condition', label: 'C', config: { metric: 'assignments.missing_due_tomorrow', op: 'gte', value: '1' } },
        end(),
      ],
      [{ source: 't', target: 'c' }],
    )
    expect(result.errors.some((e) => e.includes('true edge'))).toBe(true)
  })

  test('condition edge labelled approved is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'manual' }),
        { id: 'c', type: 'condition', label: 'C', config: { metric: 'assignments.missing_due_tomorrow', op: 'gte', value: '1' } },
        end(),
      ],
      [{ source: 't', target: 'c' }, { source: 'c', target: 'e', label: 'approved' }],
    )
    expect(result.errors.some((e) => e.includes('true or false'))).toBe(true)
  })

  test('notify with two out-edges is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'manual' }),
        { id: 'n', type: 'notify', label: 'N', config: { audience: 'roles', roles: 'admin', message: 'hi' } },
        end('e1'),
        end('e2'),
      ],
      [{ source: 't', target: 'n' }, { source: 'n', target: 'e1' }, { source: 'n', target: 'e2' }],
    )
    expect(result.errors.some((e) => e.includes('exactly one outgoing edge'))).toBe(true)
  })

  test('unknown metric is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'manual' }),
        { id: 'c', type: 'condition', label: 'C', config: { metric: 'bogus.metric', op: 'gte', value: '1' } },
        end(),
      ],
      [{ source: 't', target: 'c', label: undefined }, { source: 'c', target: 'e', label: 'true' }],
    )
    expect(result.errors.some((e) => e.includes('unknown metric'))).toBe(true)
  })

  test('subject metric under a schedule trigger is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'schedule', cron: '0 8 * * 1' }),
        {
          id: 'c',
          type: 'condition',
          label: 'C',
          config: { metric: 'attendance.session_absences', op: 'gte', value: '1' },
        },
        end(),
      ],
      [{ source: 't', target: 'c' }, { source: 'c', target: 'e', label: 'true' }, { source: 'c', target: 'e', label: 'false' }],
    )
    expect(result.errors.some((e) => e.includes('requires trigger event'))).toBe(true)
  })

  test('roles with guardian is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'manual' }),
        { id: 'n', type: 'notify', label: 'N', config: { audience: 'roles', roles: 'guardian', message: 'hi' } },
        end(),
      ],
      [{ source: 't', target: 'n' }, { source: 'n', target: 'e' }],
    )
    expect(result.errors.some((e) => e.includes('unknown role guardian'))).toBe(true)
  })

  test('message of 201 chars is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'manual' }),
        { id: 'n', type: 'notify', label: 'N', config: { audience: 'roles', roles: 'admin', message: 'x'.repeat(201) } },
        end(),
      ],
      [{ source: 't', target: 'n' }, { source: 'n', target: 'e' }],
    )
    expect(result.errors.some((e) => e.includes('1-200 characters'))).toBe(true)
  })

  test('fee_defaulters with no approval before it is rejected', () => {
    const result = expectInvalid(
      [trigger({ kind: 'manual' }), { id: 'n', type: 'notify', label: 'N', config: { audience: 'fee_defaulters' } }, end()],
      [{ source: 't', target: 'n' }, { source: 'n', target: 'e' }],
    )
    expect(result.errors.some((e) => e.includes('approval first'))).toBe(true)
  })

  test('fee_defaulters reached through a rejected edge is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'manual' }),
        { id: 'a', type: 'approval', label: 'A', config: { prompt: 'Approve?' } },
        end('e1'),
        { id: 'n', type: 'notify', label: 'N', config: { audience: 'fee_defaulters' } },
        end('e2'),
      ],
      [
        { source: 't', target: 'a' },
        { source: 'a', target: 'e1', label: 'approved' },
        { source: 'a', target: 'n', label: 'rejected' },
        { source: 'n', target: 'e2' },
      ],
    )
    expect(result.errors.some((e) => e.includes('approval first'))).toBe(true)
  })

  test('two agent nodes for one slug is rejected', () => {
    const result = expectInvalid(
      [
        trigger({ kind: 'manual' }),
        { id: 'g1', type: 'agent', label: 'G1', config: { agent: 'academic', task: 'Do X' } },
        { id: 'g2', type: 'agent', label: 'G2', config: { agent: 'academic', task: 'Do Y' } },
        end(),
      ],
      [{ source: 't', target: 'g1' }, { source: 'g1', target: 'g2' }, { source: 'g2', target: 'e' }],
    )
    expect(result.errors.some((e) => e.includes('duplicate agent'))).toBe(true)
  })

  test('cron with a step expression is rejected', () => {
    const result = expectInvalid([trigger({ kind: 'schedule', cron: '*/5 * * * *' }), end()], [{ source: 't', target: 'e' }])
    expect(result.errors.some((e) => e.includes('cron'))).toBe(true)
  })

  test('unknown config key is rejected', () => {
    const result = expectInvalid([trigger({ kind: 'manual', foo: 'bar' }), end()], [{ source: 't', target: 'e' }])
    expect(result.errors.some((e) => e.includes('unknown config key'))).toBe(true)
  })
})

describe('triggerColumns', () => {
  function graphWith(config: Record<string, string>): ParsedGraph {
    const result = parseGraph({ nodes: [trigger(config), end()], edges: [{ source: 't', target: 'e' }] })
    if (!result.ok) throw new Error(`fixture graph invalid: ${result.errors.join(', ')}`)
    return result.graph
  }

  test('schedule trigger', () => {
    expect(triggerColumns(graphWith({ kind: 'schedule', cron: '0 9 * * 1' }))).toEqual({
      trigger_type: 'schedule',
      trigger_config: '0 9 * * 1',
    })
  })

  test('event trigger', () => {
    expect(triggerColumns(graphWith({ kind: 'event', event: 'results.published' }))).toEqual({
      trigger_type: 'event',
      trigger_config: 'results.published',
    })
  })

  test('manual trigger', () => {
    expect(triggerColumns(graphWith({ kind: 'manual' }))).toEqual({ trigger_type: 'manual', trigger_config: '' })
  })
})

describe('nextNode', () => {
  test('follows the matching labelled edge, or returns null', () => {
    const result = parseGraph({
      nodes: [
        trigger({ kind: 'manual' }),
        { id: 'c', type: 'condition', label: 'C', config: { metric: 'assignments.missing_due_tomorrow', op: 'gte', value: '1' } },
        end('e1'),
        end('e2'),
      ],
      edges: [
        { source: 't', target: 'c' },
        { source: 'c', target: 'e1', label: 'true' },
        { source: 'c', target: 'e2', label: 'false' },
      ],
    })
    if (!result.ok) throw new Error(`fixture graph invalid: ${result.errors.join(', ')}`)
    expect(nextNode(result.graph, 'c', 'true')).toBe('e1')
    expect(nextNode(result.graph, 'c', 'false')).toBe('e2')
    expect(nextNode(result.graph, 't')).toBe('c')
    expect(nextNode(result.graph, 'e1')).toBe(null)
  })
})
