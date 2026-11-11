// M23-T8 — runWorkflow engine (pure; fake ports with a call log, fixed clock).
import { describe, expect, test } from 'vitest'
import { parseGraph, type ParsedGraph } from '../../src/modules/workflows/graph.ts'
import { runWorkflow, type EnginePorts, type EngineStart } from '../../src/modules/workflows/engine.ts'

const NOW = '2026-11-05T09:00:00.000Z'
const TRIGGER: EngineStart = { kind: 'trigger' }

function graphOf(nodes: unknown[], edges: unknown[]): ParsedGraph {
  const result = parseGraph({ nodes, edges })
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.graph
}

const t = { id: 't', type: 'trigger', label: 'Start', config: { kind: 'manual' } }
const e = { id: 'e', type: 'end', label: 'End', config: {} }
const overdue = { id: 'c', type: 'condition', label: 'Overdue?', config: { metric: 'finance.overdue_invoices', op: 'gte', value: '1' } }
const notifyStaff = {
  id: 'n',
  type: 'notify',
  label: 'Alert staff',
  config: { audience: 'roles', roles: 'principal', message: '{count} invoice(s) overdue.' },
}
const agentNode = { id: 'g', type: 'agent', label: 'Agent', config: { agent: 'admissions', task: 'Review enquiries.' } }
const approval = { id: 'a', type: 'approval', label: 'Approve?', config: { prompt: 'Send fee reminders?' } }

// t -> c -true-> n -> e ; c -false-> e
const conditionGraph = graphOf(
  [t, overdue, notifyStaff, e],
  [
    { source: 't', target: 'c' },
    { source: 'c', target: 'n', label: 'true' },
    { source: 'c', target: 'e', label: 'false' },
    { source: 'n', target: 'e' },
  ],
)

// t -> c -true-> n1 -> a -approved-> n2(fee_defaulters) -> e ; a -rejected-> e ; c -false-> e
const feeGraph = graphOf(
  [t, overdue, { ...notifyStaff, id: 'n1' }, approval, { id: 'n2', type: 'notify', label: 'Families', config: { audience: 'fee_defaulters' } }, e],
  [
    { source: 't', target: 'c' },
    { source: 'c', target: 'n1', label: 'true' },
    { source: 'c', target: 'e', label: 'false' },
    { source: 'n1', target: 'a' },
    { source: 'a', target: 'n2', label: 'approved' },
    { source: 'a', target: 'e', label: 'rejected' },
    { source: 'n2', target: 'e' },
  ],
)

// t -> c -true-> a -approved-> n -> e (no false / rejected edges)
const approvalGraph = graphOf(
  [t, overdue, approval, notifyStaff, e],
  [
    { source: 't', target: 'c' },
    { source: 'c', target: 'a', label: 'true' },
    { source: 'a', target: 'n', label: 'approved' },
    { source: 'n', target: 'e' },
  ],
)

type FakeOptions = {
  value?: number
  off?: string[]
  throwOn?: 'metric' | 'notify'
  now?: () => string
}

function fakePorts(opts: FakeOptions = {}) {
  const calls: string[] = []
  const ports: EnginePorts = {
    moduleOn: (key) => !(opts.off ?? []).includes(key),
    metric: async (key) => {
      calls.push(`metric:${key}`)
      if (opts.throwOn === 'metric') throw new Error('metric_failed')
      return opts.value ?? 3
    },
    notify: async (cfg, message) => {
      calls.push(`notify:${cfg.audience}:${message}`)
      if (opts.throwOn === 'notify') throw new Error('notify_failed')
      return { status: 'done', note: 'Sent: 1' }
    },
    report: async (cfg) => {
      calls.push(`report:${cfg.scheduledReportId}`)
      return { status: 'done', note: 'Queued' }
    },
    agent: async (cfg) => {
      calls.push(`agent:${cfg.agent}`)
      return { status: 'done', note: 'Queued' }
    },
    now: opts.now ?? (() => NOW),
  }
  return { ports, calls }
}

const ids = (steps: { node_id: string }[]) => steps.map((s) => s.node_id)

describe('runWorkflow', () => {
  test('condition true notifies once with {count} replaced and finishes done in 4 steps', async () => {
    const { ports, calls } = fakePorts({ value: 3 })
    const result = await runWorkflow(conditionGraph, TRIGGER, ports)

    expect(calls).toEqual(['metric:finance.overdue_invoices', 'notify:roles:3 invoice(s) overdue.'])
    expect(result.status).toBe('done')
    expect(result.cursorNodeId).toBeNull()
    expect(result.lastValue).toBe(3)
    expect(ids(result.steps)).toEqual(['t', 'c', 'n', 'e'])
    expect(result.steps[1]).toEqual({ node_id: 'c', status: 'done', at: NOW, note: 'Overdue invoices: 3 (is at least 1: yes)' })
    expect(result.steps[2]).toEqual({ node_id: 'n', status: 'done', at: NOW, note: 'Sent: 1' })
  })

  test('output carries exactly the fixture keys', async () => {
    const { ports } = fakePorts()
    const result = await runWorkflow(conditionGraph, TRIGGER, ports)

    expect(Object.keys(result).sort()).toEqual(['cursorNodeId', 'lastValue', 'status', 'steps'])
    for (const step of result.steps) expect(Object.keys(step).sort()).toEqual(['at', 'node_id', 'note', 'status'])
  })

  test('condition false without a false edge finishes done and never notifies', async () => {
    const { ports, calls } = fakePorts({ value: 0 })
    const result = await runWorkflow(approvalGraph, TRIGGER, ports)

    expect(result.status).toBe('done')
    expect(ids(result.steps)).toEqual(['t', 'c'])
    expect(result.steps[1].note).toBe('Overdue invoices: 0 (is at least 1: no)')
    expect(calls).toEqual(['metric:finance.overdue_invoices'])
  })

  test('metric module off skips the condition and takes the false path', async () => {
    const { ports, calls } = fakePorts({ off: ['finance_plus'] })
    const result = await runWorkflow(conditionGraph, TRIGGER, ports)

    expect(calls).toEqual([])
    expect(result.status).toBe('done')
    expect(ids(result.steps)).toEqual(['t', 'c', 'e'])
    expect(result.steps[1]).toMatchObject({ status: 'skipped', note: 'Module off: finance_plus' })
    expect(result.lastValue).toBeNull()
  })

  test('agent module off skips the agent step without calling the port and the run continues', async () => {
    const graph = graphOf([t, agentNode, e], [{ source: 't', target: 'g' }, { source: 'g', target: 'e' }])
    const { ports, calls } = fakePorts({ off: ['agents'] })
    const result = await runWorkflow(graph, TRIGGER, ports)

    expect(calls).toEqual([])
    expect(result.status).toBe('done')
    expect(ids(result.steps)).toEqual(['t', 'g', 'e'])
    expect(result.steps[1]).toMatchObject({ status: 'skipped', note: 'Module off: agents' })
  })

  test('approval pauses the run awaiting approval with the cursor on the approval node', async () => {
    const { ports, calls } = fakePorts({ value: 3 })
    const result = await runWorkflow(feeGraph, TRIGGER, ports)

    expect(result.status).toBe('awaiting_approval')
    expect(result.cursorNodeId).toBe('a')
    expect(result.lastValue).toBe(3)
    expect(ids(result.steps)).toEqual(['t', 'c', 'n1', 'a'])
    expect(result.steps.at(-1)).toEqual({ node_id: 'a', status: 'running', at: NOW, note: 'Send fee reminders?' })
    expect(calls).toEqual(['metric:finance.overdue_invoices', 'notify:roles:3 invoice(s) overdue.'])
  })

  test('resume approved follows the approved edge and uses lastValue from the start', async () => {
    const { ports, calls } = fakePorts()
    const result = await runWorkflow(approvalGraph, { kind: 'resume', nodeId: 'a', decision: 'approved', lastValue: 7 }, ports)

    expect(result.status).toBe('done')
    expect(result.cursorNodeId).toBeNull()
    expect(result.lastValue).toBe(7)
    expect(ids(result.steps)).toEqual(['a', 'n', 'e'])
    expect(result.steps[0]).toEqual({ node_id: 'a', status: 'done', at: NOW, note: 'Approved' })
    expect(calls).toEqual(['notify:roles:7 invoice(s) overdue.'])
  })

  test('resume rejected without a rejected edge finishes done and calls nothing after it', async () => {
    const { ports, calls } = fakePorts()
    const result = await runWorkflow(approvalGraph, { kind: 'resume', nodeId: 'a', decision: 'rejected', lastValue: 7 }, ports)

    expect(result.status).toBe('done')
    expect(result.steps).toEqual([{ node_id: 'a', status: 'done', at: NOW, note: 'Rejected' }])
    expect(calls).toEqual([])
  })

  test('a throwing port fails that step and the run, and later ports are not called', async () => {
    const graph = graphOf(
      [t, notifyStaff, agentNode, e],
      [{ source: 't', target: 'n' }, { source: 'n', target: 'g' }, { source: 'g', target: 'e' }],
    )
    const { ports, calls } = fakePorts({ throwOn: 'notify' })
    const result = await runWorkflow(graph, TRIGGER, ports)

    expect(result.status).toBe('failed')
    expect(result.cursorNodeId).toBeNull()
    expect(ids(result.steps)).toEqual(['t', 'n'])
    expect(result.steps[1]).toEqual({ node_id: 'n', status: 'failed', at: NOW, note: 'Failed: notify_failed' })
    expect(calls).toEqual(['notify:roles:0 invoice(s) overdue.'])
  })

  test('fee_defaulters notify is skipped when finance_plus is off', async () => {
    const { ports, calls } = fakePorts({ off: ['finance_plus'] })
    const result = await runWorkflow(feeGraph, { kind: 'resume', nodeId: 'a', decision: 'approved', lastValue: 3 }, ports)

    expect(result.status).toBe('done')
    expect(ids(result.steps)).toEqual(['a', 'n2', 'e'])
    expect(result.steps[1]).toMatchObject({ status: 'skipped', note: 'Module off: finance_plus' })
    expect(calls).toEqual([])
  })

  test('never rejects: a throwing metric resolves to a failed run', async () => {
    const { ports } = fakePorts({ throwOn: 'metric' })
    const result = await runWorkflow(conditionGraph, TRIGGER, ports)

    expect(result.status).toBe('failed')
    expect(ids(result.steps)).toEqual(['t', 'c'])
    expect(result.steps[1]).toMatchObject({ status: 'failed', note: 'Failed: metric_failed' })
  })

  test('never rejects: a throwing clock still resolves to a failed run', async () => {
    const { ports } = fakePorts({
      now: () => {
        throw new Error('clock')
      },
    })
    await expect(runWorkflow(conditionGraph, TRIGGER, ports)).resolves.toMatchObject({ status: 'failed' })
  })

  test('every step carries ports.now()', async () => {
    let tick = 0
    const { ports } = fakePorts({ now: () => `T${++tick}` })
    const result = await runWorkflow(conditionGraph, TRIGGER, ports)

    expect(result.steps.map((s) => s.at)).toEqual(['T1', 'T2', 'T3', 'T4'])
  })
})
