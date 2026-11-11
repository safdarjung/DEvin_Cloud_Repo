// M23-T8 — workflow engine. Pure: no IO and no clock; IO only through injected
// ports (mirrors runOnceCore + RunnerPorts). Relative .ts imports (runner-safe).
import type { ModuleKey } from '../../lib/modules/catalog.ts'
import type { WorkflowRun } from '../fabric/types.ts'
import { NODE_MODULE, WORKFLOW_METRICS, type WorkflowMetricKey } from './catalog.ts'
import { OP_WORDS } from './describe.ts'
import {
  nextNode,
  type AgentConfig,
  type ConditionConfig,
  type NotifyConfig,
  type ParsedGraph,
  type ParsedNode,
  type ReportConfig,
} from './graph.ts'

export type NodeOutcome = { status: 'done' | 'skipped'; note: string }

export type EnginePorts = {
  moduleOn(key: ModuleKey): boolean
  /** `section`: the condition's class section, set only for a SECTION_METRICS metric. */
  metric(key: WorkflowMetricKey, section?: string): Promise<number>
  notify(cfg: NotifyConfig, message: string): Promise<NodeOutcome>
  report(cfg: ReportConfig): Promise<NodeOutcome>
  agent(cfg: AgentConfig): Promise<NodeOutcome>
  now(): string
}

export type EngineStart =
  | { kind: 'trigger' }
  | { kind: 'resume'; nodeId: string; decision: 'approved' | 'rejected'; lastValue: number | null }

export type EngineResult = {
  status: 'done' | 'failed' | 'awaiting_approval'
  steps: WorkflowRun['steps']
  cursorNodeId: string | null
  lastValue: number | null
}

type Step = WorkflowRun['steps'][number]

const MAX_STEPS = 100 // defensive: a validated DAG of ≤30 nodes cannot reach it
const MAX_NOTE = 200
const MAX_ERROR = 60

const COMPARE: Record<ConditionConfig['op'], (a: number, b: number) => boolean> = {
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  eq: (a, b) => a === b,
}

/** Module gating an action node; null = core (notify to roles). */
function actionModule(node: Extract<ParsedNode, { type: 'notify' | 'report' | 'agent' }>): ModuleKey | null {
  if (node.type === 'notify') return node.config.audience === 'fee_defaulters' ? NODE_MODULE.fee_defaulters : null
  return NODE_MODULE[node.type]
}

/** Walks one path of a parsed graph. Never rejects: any throw becomes a `failed` step and run. */
export async function runWorkflow(graph: ParsedGraph, start: EngineStart, ports: EnginePorts): Promise<EngineResult> {
  const steps: Step[] = []
  let lastValue = start.kind === 'resume' ? start.lastValue : null
  let current: string | null = null
  const push = (node_id: string, status: Step['status'], note: string) =>
    steps.push({ node_id, status, at: ports.now(), note: note.slice(0, MAX_NOTE) })
  const result = (status: EngineResult['status'], cursorNodeId: string | null = null): EngineResult => ({
    status,
    steps,
    cursorNodeId,
    lastValue,
  })

  try {
    let nodeId: string | null = graph.triggerId
    if (start.kind === 'resume') {
      current = start.nodeId
      if (graph.nodes.get(start.nodeId)?.type !== 'approval') throw new Error('invalid_resume')
      push(start.nodeId, 'done', start.decision === 'approved' ? 'Approved' : 'Rejected')
      nodeId = nextNode(graph, start.nodeId, start.decision) // missing `rejected` edge → run done
    }

    while (nodeId !== null) {
      const node = graph.nodes.get(nodeId)
      if (!node || steps.length >= MAX_STEPS) return result('failed')
      current = node.id

      switch (node.type) {
        case 'trigger':
          push(node.id, 'done', node.config.kind === 'event' ? node.config.event : node.config.kind)
          nodeId = nextNode(graph, node.id)
          break
        case 'condition': {
          const { metric, op, value, section } = node.config
          const moduleKey = WORKFLOW_METRICS[metric].module
          let pass = false
          if (!ports.moduleOn(moduleKey)) {
            push(node.id, 'skipped', `Module off: ${moduleKey}`)
          } else {
            const v = section === undefined ? await ports.metric(metric) : await ports.metric(metric, section)
            lastValue = v
            pass = COMPARE[op](v, value)
            push(node.id, 'done', `${WORKFLOW_METRICS[metric].label}: ${v} (${OP_WORDS[op]} ${value}: ${pass ? 'yes' : 'no'})`)
          }
          nodeId = nextNode(graph, node.id, String(pass)) // missing `false` edge → run done
          break
        }
        case 'notify':
        case 'report':
        case 'agent': {
          const moduleKey = actionModule(node)
          if (moduleKey && !ports.moduleOn(moduleKey)) {
            push(node.id, 'skipped', `Module off: ${moduleKey}`)
          } else {
            const outcome =
              node.type === 'notify'
                ? await ports.notify(
                    node.config,
                    node.config.audience === 'roles' ? node.config.message.replaceAll('{count}', String(lastValue ?? 0)) : '',
                  )
                : node.type === 'report'
                  ? await ports.report(node.config)
                  : await ports.agent(node.config)
            push(node.id, outcome.status, outcome.note)
          }
          nodeId = nextNode(graph, node.id)
          break
        }
        case 'approval':
          push(node.id, 'running', node.config.prompt)
          return result('awaiting_approval', node.id)
        case 'end':
          push(node.id, 'done', node.label)
          return result('done')
      }
    }
    return result('done')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      if (current !== null) push(current, 'failed', `Failed: ${message.slice(0, MAX_ERROR)}`)
    } catch {
      // ports.now() itself threw: keep the steps recorded so far.
    }
    return result('failed')
  }
}
