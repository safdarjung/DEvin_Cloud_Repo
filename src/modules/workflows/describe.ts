// Plain-language text for workflow triggers and schedules, and the schedule
// picker <-> cron mapping. Pure; relative .ts imports (engine/runner-safe).
import { CONDITION_OPS, type WorkflowEventKey } from './catalog.ts'

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export const OP_WORDS: Record<(typeof CONDITION_OPS)[number], string> = {
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  eq: 'equals',
}

export const EVENT_PHRASES: Record<WorkflowEventKey, string> = {
  'attendance.absences_submitted': "When a class's absences are submitted",
  'results.published': 'When exam results are published',
  'enquiry.received': 'When an admission enquiry arrives',
}

export type ScheduleFrequency = 'daily' | 'mon_fri' | 'mon_sat' | 'weekly'
export const SCHEDULE_FREQUENCIES: Record<ScheduleFrequency, string> = {
  daily: 'Every day',
  mon_fri: 'Mon–Fri',
  mon_sat: 'Mon–Sat',
  weekly: 'Once a week',
}
export { DAY_LONG }

/** `day` (0 = Sunday) is used only by `weekly`; `time` is 24-hour `HH:MM`. */
export interface SchedulePick {
  frequency: ScheduleFrequency
  day: number
  time: string
}

const RANGE_DOW: Record<string, Exclude<ScheduleFrequency, 'weekly'>> = { '*': 'daily', '1-5': 'mon_fri', '1-6': 'mon_sat' }
const pad = (n: number) => String(n).padStart(2, '0')

export function cronFromPick(pick: SchedulePick): string {
  const [hour, minute] = pick.time.split(':').map(Number)
  const dow = pick.frequency === 'weekly' ? String(pick.day) : Object.keys(RANGE_DOW).find((k) => RANGE_DOW[k] === pick.frequency)
  return `${minute} ${hour} * * ${dow}`
}

/** The picker state for a cron it can show, else null (that cron is kept and shown as a custom schedule). */
export function pickFromCron(cron: string): SchedulePick | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|1-6|[0-6])$/.exec(cron.trim())
  if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) return null
  const time = `${pad(Number(m[2]))}:${pad(Number(m[1]))}`
  const dow = m[3]
  return dow in RANGE_DOW ? { frequency: RANGE_DOW[dow], day: 1, time } : { frequency: 'weekly', day: Number(dow), time }
}

function daysText(dow: string): string | null {
  if (dow === '*') return 'Every day'
  if (/^[0-6]$/.test(dow)) return `Every ${DAY_LONG[Number(dow)]}`
  const range = /^([0-6])-([0-6])$/.exec(dow)
  if (range && Number(range[1]) < Number(range[2])) return `${DAY_SHORT[Number(range[1])]}–${DAY_SHORT[Number(range[2])]}`
  if (/^[0-6](,[0-6])+$/.test(dow)) return dow.split(',').map((d) => DAY_SHORT[Number(d)]).join(', ')
  return null
}

/** "Mon–Sat at 10:00". A cron outside the M H * * DOW / M H DOM * * shapes stays visible as "Custom schedule (…)". */
export function describeCron(cron: string): string {
  const custom = `Custom schedule (${cron})`
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return custom
  const [minute, hour, dom, month, dow] = parts
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour) || month !== '*') return custom
  const at = `at ${pad(Number(hour))}:${pad(Number(minute))}`
  if (dom !== '*') return /^\d{1,2}$/.test(dom) && dow === '*' ? `Day ${Number(dom)} of every month ${at}` : custom
  const days = daysText(dow)
  return days ? `${days} ${at}` : custom
}

export function describeTrigger(type: string, config: string): string {
  if (type === 'schedule') return describeCron(config)
  if (type === 'event') return EVENT_PHRASES[config as WorkflowEventKey] ?? config
  return 'By hand'
}
