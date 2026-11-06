// M23-T7 — pure graph validator. No IO. Relative .ts imports (seed/runner-safe).
import { z } from 'zod'
import { CronSchema } from '../reports/schemas.ts'
import {
  WORKFLOW_EVENTS,
  WORKFLOW_METRICS,
  NOTIFY_ROLES,
  CONDITION_OPS,
  type WorkflowEventKey,
  type WorkflowMetricKey,
} from './catalog.ts'
import { WorkflowNodeSchema, GraphEdgeSchema, type WorkflowNode } from './schemas.ts'
import { AGENT_SLUGS, type AgentSlug } from '../agents/catalog.ts'

const MAX_ERRORS = 20

export type TriggerConfig =
  | { kind: 'schedule'; cron: string }
  | { kind: 'event'; event: WorkflowEventKey }
  | { kind: 'manual' }

export type ConditionConfig = {
  metric: WorkflowMetricKey
  op: (typeof CONDITION_OPS)[number]
  value: number
}

export type NotifyConfig =
  | { audience: 'roles'; roles: readonly (typeof NOTIFY_ROLES)[number][]; message: string }
  | { audience: 'fee_defaulters' }

export type ReportConfig = { scheduledReportId: string }

export type AgentConfig = { agent: AgentSlug; task: string }

export type ApprovalConfig = { prompt: string }

export type ParsedNode =
  | { id: string; type: 'trigger'; label: string; config: TriggerConfig }
  | { id: string; type: 'condition'; label: string; config: ConditionConfig }
  | { id: string; type: 'notify'; label: string; config: NotifyConfig }
  | { id: string; type: 'report'; label: string; config: ReportConfig }
  | { id: string; type: 'agent'; label: string; config: AgentConfig }
  | { id: string; type: 'approval'; label: string; config: ApprovalConfig }
  | { id: string; type: 'end'; label: string; config: Record<string, never> }

type OutEdge = { target: string; label?: string }

export type ParsedGraph = {
  nodes: ReadonlyMap<string, ParsedNode>
  out: ReadonlyMap<string, readonly OutEdge[]>
  triggerId: string
}

type ParseResult = { ok: true; graph: ParsedGraph } | { ok: false; errors: string[] }

const NodesArraySchema = z.array(WorkflowNodeSchema).min(2).max(30)
const EdgesArraySchema = z.array(GraphEdgeSchema).min(1).max(60)

type ConfigParseResult = { ok: true; config: ParsedNode['config'] } | { ok: false; error: string }

function parseNodeConfig(node: WorkflowNode): ConfigParseResult {
  const config = node.config
  const keys = Object.keys(config)
  const fail = (message: string): ConfigParseResult => ({ ok: false, error: `node ${node.id}: ${message}` })

  switch (node.type) {
    case 'tool':
      return fail('node type tool is not supported')

    case 'trigger': {
      const kind = config.kind
      if (kind === 'schedule') {
        const extra = keys.find((k) => k !== 'kind' && k !== 'cron')
        if (extra) return fail(`unknown config key ${extra}`)
        if (config.cron === undefined) return fail('schedule trigger needs cron')
        const cronResult = CronSchema.safeParse(config.cron)
        if (!cronResult.success) return fail(`invalid cron: ${cronResult.error.issues[0]?.message ?? 'invalid'}`)
        return { ok: true, config: { kind: 'schedule', cron: cronResult.data } }
      }
      if (kind === 'event') {
        const extra = keys.find((k) => k !== 'kind' && k !== 'event')
        if (extra) return fail(`unknown config key ${extra}`)
        const event = config.event
        if (!event || !(event in WORKFLOW_EVENTS)) return fail('unknown event')
        return { ok: true, config: { kind: 'event', event: event as WorkflowEventKey } }
      }
      if (kind === 'manual') {
        const extra = keys.find((k) => k !== 'kind')
        if (extra) return fail(`unknown config key ${extra}`)
        return { ok: true, config: { kind: 'manual' } }
      }
      return fail('trigger kind must be schedule, event, or manual')
    }

    case 'condition': {
      const extra = keys.find((k) => k !== 'metric' && k !== 'op' && k !== 'value')
      if (extra) return fail(`unknown config key ${extra}`)
      const metric = config.metric
      if (!metric || !(metric in WORKFLOW_METRICS)) return fail('unknown metric')
      const op = config.op
      if (!op || !(CONDITION_OPS as readonly string[]).includes(op)) return fail('unknown operator')
      const value = config.value
      if (!value || !/^[0-9]{1,6}$/.test(value)) return fail('value must be 1-6 digits')
      return {
        ok: true,
        config: {
          metric: metric as WorkflowMetricKey,
          op: op as (typeof CONDITION_OPS)[number],
          value: Number(value),
        },
      }
    }

    case 'notify': {
      const audience = config.audience
      if (audience === 'roles') {
        const extra = keys.find((k) => k !== 'audience' && k !== 'roles' && k !== 'message')
        if (extra) return fail(`unknown config key ${extra}`)
        const rolesRaw = config.roles
        if (!rolesRaw) return fail('roles audience needs roles')
        const roleList = rolesRaw.split(',').map((r) => r.trim())
        if (roleList.length < 1 || roleList.length > 7) return fail('roles must list 1-7 values')
        if (new Set(roleList).size !== roleList.length) return fail('roles must be unique')
        for (const role of roleList) {
          if (!(NOTIFY_ROLES as readonly string[]).includes(role)) return fail(`unknown role ${role}`)
        }
        const message = config.message
        if (!message) return fail('roles audience needs message')
        if (message.length < 1 || message.length > 200) return fail('message must be 1-200 characters')
        if (message.split('{count}').length - 1 > 1) return fail('message allows at most one {count} placeholder')
        return {
          ok: true,
          config: { audience: 'roles', roles: roleList as (typeof NOTIFY_ROLES)[number][], message },
        }
      }
      if (audience === 'fee_defaulters') {
        const extra = keys.find((k) => k !== 'audience')
        if (extra) return fail(`unknown config key ${extra}`)
        return { ok: true, config: { audience: 'fee_defaulters' } }
      }
      return fail('notify audience must be roles or fee_defaulters')
    }

    case 'report': {
      const extra = keys.find((k) => k !== 'scheduledReportId')
      if (extra) return fail(`unknown config key ${extra}`)
      const id = config.scheduledReportId
      if (!id || !z.string().uuid().safeParse(id).success) return fail('scheduledReportId must be a uuid')
      return { ok: true, config: { scheduledReportId: id } }
    }

    case 'agent': {
      const extra = keys.find((k) => k !== 'agent' && k !== 'task')
      if (extra) return fail(`unknown config key ${extra}`)
      const agent = config.agent
      if (!agent || !(AGENT_SLUGS as readonly string[]).includes(agent)) return fail('unknown agent')
      const task = config.task
      if (!task || task.length < 1 || task.length > 500) return fail('task must be 1-500 characters')
      return { ok: true, config: { agent: agent as AgentSlug, task } }
    }

    case 'approval': {
      const extra = keys.find((k) => k !== 'prompt')
      if (extra) return fail(`unknown config key ${extra}`)
      const prompt = config.prompt
      if (!prompt || prompt.length < 1 || prompt.length > 120) return fail('prompt must be 1-120 characters')
      return { ok: true, config: { prompt } }
    }

    case 'end': {
      if (keys.length > 0) return fail(`unknown config key ${keys[0]}`)
      return { ok: true, config: {} }
    }
  }
}

function checkOutEdges(node: WorkflowNode, edgesOut: OutEdge[], pushError: (message: string) => void): void {
  switch (node.type) {
    case 'trigger':
    case 'notify':
    case 'report':
    case 'agent': {
      if (edgesOut.length !== 1) {
        pushError(`node ${node.id}: must have exactly one outgoing edge`)
      } else if (edgesOut[0].label !== undefined) {
        pushError(`node ${node.id}: outgoing edge must not be labelled`)
      }
      return
    }
    case 'condition': {
      const trueEdges = edgesOut.filter((e) => e.label === 'true')
      const falseEdges = edgesOut.filter((e) => e.label === 'false')
      const other = edgesOut.filter((e) => e.label !== 'true' && e.label !== 'false')
      if (trueEdges.length !== 1) pushError(`node ${node.id}: condition needs exactly one true edge`)
      if (falseEdges.length > 1) pushError(`node ${node.id}: condition allows at most one false edge`)
      if (other.length > 0) pushError(`node ${node.id}: condition edges must be labelled true or false`)
      return
    }
    case 'approval': {
      const approvedEdges = edgesOut.filter((e) => e.label === 'approved')
      const rejectedEdges = edgesOut.filter((e) => e.label === 'rejected')
      const other = edgesOut.filter((e) => e.label !== 'approved' && e.label !== 'rejected')
      if (approvedEdges.length !== 1) pushError(`node ${node.id}: approval needs exactly one approved edge`)
      if (rejectedEdges.length > 1) pushError(`node ${node.id}: approval allows at most one rejected edge`)
      if (other.length > 0) pushError(`node ${node.id}: approval edges must be labelled approved or rejected`)
      return
    }
    case 'end': {
      if (edgesOut.length > 0) pushError(`node ${node.id}: end node cannot have outgoing edges`)
      return
    }
    case 'tool':
      return // already reported by parseNodeConfig
  }
}

function bfsReachable(
  startId: string,
  out: Map<string, OutEdge[]>,
  allowEdge?: (fromId: string, label: string | undefined) => boolean,
): Set<string> {
  const seen = new Set<string>([startId])
  const queue: string[] = [startId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const edge of out.get(current) ?? []) {
      if (allowEdge && !allowEdge(current, edge.label)) continue
      if (!seen.has(edge.target)) {
        seen.add(edge.target)
        queue.push(edge.target)
      }
    }
  }
  return seen
}

function findCycle(startId: string, out: Map<string, OutEdge[]>): string | null {
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function visit(id: string): string | null {
    if (inStack.has(id)) return id
    if (visited.has(id)) return null
    visited.add(id)
    inStack.add(id)
    for (const edge of out.get(id) ?? []) {
      const found = visit(edge.target)
      if (found) return found
    }
    inStack.delete(id)
    return null
  }

  return visit(startId)
}

export function parseGraph(input: { nodes: unknown; edges: unknown }): ParseResult {
  const errors: string[] = []
  const pushError = (message: string) => {
    if (errors.length < MAX_ERRORS) errors.push(message)
  }

  const nodesResult = NodesArraySchema.safeParse(input.nodes)
  const edgesResult = EdgesArraySchema.safeParse(input.edges)

  if (!nodesResult.success) {
    for (const issue of nodesResult.error.issues) pushError(`nodes.${issue.path.join('.')}: ${issue.message}`)
  }
  if (!edgesResult.success) {
    for (const issue of edgesResult.error.issues) pushError(`edges.${issue.path.join('.')}: ${issue.message}`)
  }
  if (!nodesResult.success || !edgesResult.success) return { ok: false, errors }

  const rawNodes = nodesResult.data
  const rawEdges = edgesResult.data

  const nodeById = new Map<string, WorkflowNode>()
  for (const node of rawNodes) {
    if (nodeById.has(node.id)) pushError(`node ${node.id}: duplicate node id`)
    nodeById.set(node.id, node)
  }

  const seenEdgeKeys = new Set<string>()
  for (const edge of rawEdges) {
    if (!nodeById.has(edge.source)) pushError(`edge ${edge.source}->${edge.target}: unknown source node`)
    if (!nodeById.has(edge.target)) pushError(`edge ${edge.source}->${edge.target}: unknown target node`)
    if (edge.source === edge.target) pushError(`node ${edge.source}: self-loop not allowed`)
    const key = `${edge.source}|${edge.target}|${edge.label ?? ''}`
    if (seenEdgeKeys.has(key)) pushError(`edge ${edge.source}->${edge.target}: duplicate edge`)
    seenEdgeKeys.add(key)
  }

  const out = new Map<string, OutEdge[]>()
  for (const id of nodeById.keys()) out.set(id, [])
  const hasIncoming = new Set<string>()
  for (const edge of rawEdges) {
    hasIncoming.add(edge.target)
    out.get(edge.source)?.push({ target: edge.target, label: edge.label })
  }

  const triggerNodes = rawNodes.filter((n) => n.type === 'trigger')
  if (triggerNodes.length === 0) {
    pushError('graph: exactly one trigger node is required')
  } else if (triggerNodes.length > 1) {
    for (const node of triggerNodes.slice(1)) pushError(`node ${node.id}: only one trigger node allowed`)
  }
  for (const node of triggerNodes) {
    if (hasIncoming.has(node.id)) pushError(`node ${node.id}: trigger node cannot have an incoming edge`)
  }

  const parsedConfigs = new Map<string, ParsedNode['config']>()
  for (const node of rawNodes) {
    const result = parseNodeConfig(node)
    if (!result.ok) {
      pushError(result.error)
      continue
    }
    parsedConfigs.set(node.id, result.config)
  }

  for (const node of rawNodes) {
    checkOutEdges(node, out.get(node.id) ?? [], pushError)
  }

  if (triggerNodes.length === 1) {
    const triggerId = triggerNodes[0].id
    const reachable = bfsReachable(triggerId, out)
    for (const node of rawNodes) {
      if (!reachable.has(node.id)) pushError(`node ${node.id}: unreachable from trigger`)
    }

    const cycleNode = findCycle(triggerId, out)
    if (cycleNode) pushError(`node ${cycleNode}: cycle detected`)

    const hasEnd = rawNodes.some((n) => n.type === 'end' && reachable.has(n.id))
    if (!hasEnd) pushError('graph: at least one end node must be reachable from the trigger')

    const triggerConfig = parsedConfigs.get(triggerId) as TriggerConfig | undefined
    for (const node of rawNodes) {
      if (node.type !== 'condition') continue
      const cfg = parsedConfigs.get(node.id) as ConditionConfig | undefined
      if (!cfg) continue
      const metricDef = WORKFLOW_METRICS[cfg.metric]
      const subjectEvent: string | null = metricDef.event
      if (subjectEvent && !(triggerConfig?.kind === 'event' && triggerConfig.event === subjectEvent)) {
        pushError(`node ${node.id}: metric ${cfg.metric} requires trigger event ${subjectEvent}`)
      }
    }

    const gatedReachable = bfsReachable(triggerId, out, (fromId, label) => {
      const fromNode = nodeById.get(fromId)
      return !(fromNode?.type === 'approval' && label === 'approved')
    })
    for (const node of rawNodes) {
      if (node.type !== 'notify') continue
      const cfg = parsedConfigs.get(node.id) as NotifyConfig | undefined
      if (cfg?.audience === 'fee_defaulters' && gatedReachable.has(node.id)) {
        pushError(`node ${node.id}: family reminders need an approval first`)
      }
    }

    const agentSlugSeen = new Map<string, string>()
    for (const node of rawNodes) {
      if (node.type !== 'agent') continue
      const cfg = parsedConfigs.get(node.id) as AgentConfig | undefined
      if (!cfg) continue
      const prior = agentSlugSeen.get(cfg.agent)
      if (prior) pushError(`node ${node.id}: duplicate agent node for slug ${cfg.agent} (also node ${prior})`)
      else agentSlugSeen.set(cfg.agent, node.id)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const nodes = new Map<string, ParsedNode>()
  for (const node of rawNodes) {
    nodes.set(node.id, {
      id: node.id,
      type: node.type,
      label: node.label,
      config: parsedConfigs.get(node.id)!,
    } as ParsedNode)
  }

  return { ok: true, graph: { nodes, out, triggerId: triggerNodes[0].id } }
}

export function triggerColumns(graph: ParsedGraph): { trigger_type: 'schedule' | 'event' | 'manual'; trigger_config: string } {
  const trigger = graph.nodes.get(graph.triggerId)
  if (!trigger || trigger.type !== 'trigger') throw new Error('graph has no trigger node')
  const config = trigger.config
  if (config.kind === 'schedule') return { trigger_type: 'schedule', trigger_config: config.cron }
  if (config.kind === 'event') return { trigger_type: 'event', trigger_config: config.event }
  return { trigger_type: 'manual', trigger_config: '' }
}

export function nextNode(graph: ParsedGraph, nodeId: string, label?: string): string | null {
  const edges = graph.out.get(nodeId) ?? []
  const match = edges.find((edge) => (label === undefined ? edge.label === undefined : edge.label === label))
  return match ? match.target : null
}
