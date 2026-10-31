import { FixtureOpts, rng, isoDate, addDays, SECTION_LABELS, SUBJECTS } from './prng'
import { MasteryCell, CurriculumCoverage, AssessmentPlanItem } from '../types'

const SECTIONS = SECTION_LABELS.slice(0, 6) // VI-A, VI-B, VII-A, VII-B, VIII-A, VIII-B
const SUBJECT_LIST = SUBJECTS.slice(0, 5) // Math, Science, English, Hindi, Social Science
const TOPICS = [
  'Numbers and Operations',
  'Geometry and Shapes',
  'Data and Probability',
  'Algebra and Functions'
]
const KINDS = ['unit_test', 'term_exam', 'practical', 'quiz'] as const
const STATUSES = ['planned', 'scheduled', 'marked', 'published'] as const

export function masteryCells(opts: FixtureOpts): MasteryCell[] {
  const r = rng(opts.seed)
  const cells: MasteryCell[] = []

  for (const section of SECTIONS) {
    for (const subject of SUBJECT_LIST) {
      for (const topic of TOPICS) {
        const isWeakSpot = r.chance(0.12) // ~12% weak spots
        const mastery = isWeakSpot ? r.int(20, 40) : r.int(35, 95)

        cells.push({
          section_id: r.id('sec', r.int(1, 100)),
          section_label: section,
          subject,
          topic_id: r.id('topic', r.int(1, 100)),
          topic,
          mastery_pct: Math.max(0, Math.min(100, mastery)),
          students_below_threshold: isWeakSpot ? r.int(3, 10) : r.int(0, 2)
        })
      }
    }
  }

  return cells
}

export function curriculumCoverage(opts: FixtureOpts): CurriculumCoverage[] {
  const r = rng(opts.seed)
  const rows: CurriculumCoverage[] = []

  for (const section of SECTIONS) {
    for (const subject of SUBJECT_LIST) {
      const planned = r.int(20, 35)
      const completed = r.int(10, planned)

      rows.push({
        subject,
        section_label: section,
        planned_units: planned,
        completed_units: completed,
        on_track: completed >= planned * 0.8
      })
    }
  }

  return rows
}

export function assessmentPlan(opts: FixtureOpts): AssessmentPlanItem[] {
  const r = rng(opts.seed)
  const items: AssessmentPlanItem[] = []

  for (let i = 0; i < 12; i++) {
    const daysOffset = r.int(-45, 45)
    const date = addDays(opts.now, daysOffset)

    items.push({
      id: r.id('asmt', i),
      title: `Assessment ${i + 1}`,
      subject: r.pick(SUBJECT_LIST),
      section_label: r.pick(SECTIONS),
      date: isoDate(date),
      kind: r.pick(KINDS),
      status: r.pick(STATUSES)
    })
  }

  return items
}
