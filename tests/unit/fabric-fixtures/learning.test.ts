import { describe, it, expect } from 'vitest'
import { masteryCells, curriculumCoverage, assessmentPlan } from '@/modules/fabric/demo/learning'

describe('learning fixtures', () => {
  const now = new Date('2026-10-31')
  const opts = { seed: 42, now, institutionId: 'inst-0001' }

  describe('masteryCells', () => {
    it('generates 120 cells (6 sections × 5 subjects × 4 topics)', () => {
      const cells = masteryCells(opts)
      expect(cells).toHaveLength(120)
    })

    it('mastery_pct is within 0–100', () => {
      const cells = masteryCells(opts)
      cells.forEach(cell => {
        expect(cell.mastery_pct).toBeGreaterThanOrEqual(0)
        expect(cell.mastery_pct).toBeLessThanOrEqual(100)
      })
    })

    it('deterministic with same seed', () => {
      const cells1 = masteryCells(opts)
      const cells2 = masteryCells(opts)
      expect(cells1).toEqual(cells2)
    })

    it('different seed produces different results', () => {
      const cells1 = masteryCells(opts)
      const cells2 = masteryCells({ ...opts, seed: 99 })
      expect(cells1).not.toEqual(cells2)
    })

    it('has weak spots with lower mastery', () => {
      const cells = masteryCells(opts)
      const weakSpots = cells.filter(c => c.mastery_pct < 45)
      expect(weakSpots.length).toBeGreaterThan(0)
    })
  })

  describe('curriculumCoverage', () => {
    it('generates 30 rows (6 sections × 5 subjects)', () => {
      const rows = curriculumCoverage(opts)
      expect(rows).toHaveLength(30)
    })

    it('completed_units ≤ planned_units', () => {
      const rows = curriculumCoverage(opts)
      rows.forEach(row => {
        expect(row.completed_units).toBeLessThanOrEqual(row.planned_units)
      })
    })

    it('deterministic with same seed', () => {
      const rows1 = curriculumCoverage(opts)
      const rows2 = curriculumCoverage(opts)
      expect(rows1).toEqual(rows2)
    })

    it('on_track reflects coverage ratio', () => {
      const rows = curriculumCoverage(opts)
      rows.forEach(row => {
        const coverage = row.completed_units / row.planned_units
        expect(row.on_track).toBe(coverage >= 0.8)
      })
    })
  })

  describe('assessmentPlan', () => {
    it('generates 12 items', () => {
      const items = assessmentPlan(opts)
      expect(items).toHaveLength(12)
    })

    it('dates are within ±45 days of opts.now', () => {
      const items = assessmentPlan(opts)
      const nowMs = opts.now.getTime()
      const _45days = 45 * 86_400_000

      items.forEach(item => {
        const itemDate = new Date(item.date).getTime()
        const diff = Math.abs(itemDate - nowMs)
        expect(diff).toBeLessThanOrEqual(_45days)
      })
    })

    it('deterministic with same seed', () => {
      const items1 = assessmentPlan(opts)
      const items2 = assessmentPlan(opts)
      expect(items1).toEqual(items2)
    })

    it('has mixed kinds and statuses', () => {
      const items = assessmentPlan(opts)
      const kinds = new Set(items.map(i => i.kind))
      const statuses = new Set(items.map(i => i.status))

      expect(kinds.size).toBeGreaterThan(1)
      expect(statuses.size).toBeGreaterThan(1)
    })

    it('title length ≤ 200 chars', () => {
      const items = assessmentPlan(opts)
      items.forEach(item => {
        expect(item.title.length).toBeLessThanOrEqual(200)
      })
    })
  })
})
