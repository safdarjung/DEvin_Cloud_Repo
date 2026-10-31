import { describe, it, expect, beforeEach } from 'vitest'
import {
  financeForecast,
  outstandingAlerts,
  budgetLines,
} from '@/modules/fabric/demo/finance-intel'
import { FixtureOpts } from '@/modules/fabric/demo/prng'

describe('finance-intel fixtures', () => {
  let opts: FixtureOpts

  beforeEach(() => {
    opts = {
      seed: 42,
      now: new Date('2026-10-31'),
      institutionId: 'inst-test-001',
    }
  })

  describe('financeForecast', () => {
    it('returns 12 month points (6 past, 6 future)', () => {
      const forecast = financeForecast(opts)
      expect(forecast).toHaveLength(12)
    })

    it('past months have collected > 0', () => {
      const forecast = financeForecast(opts)
      forecast.slice(0, 6).forEach((point) => {
        expect(point.collected_paise).toBeGreaterThan(0)
      })
    })

    it('future months have collected = 0', () => {
      const forecast = financeForecast(opts)
      forecast.slice(6, 12).forEach((point) => {
        expect(point.collected_paise).toBe(0)
      })
    })

    it('forecast_low <= expected <= forecast_high', () => {
      const forecast = financeForecast(opts)
      forecast.forEach((point) => {
        expect(point.forecast_low_paise).toBeLessThanOrEqual(point.expected_paise)
        expect(point.expected_paise).toBeLessThanOrEqual(point.forecast_high_paise)
      })
    })

    it('all values are integers (paise)', () => {
      const forecast = financeForecast(opts)
      forecast.forEach((point) => {
        expect(Number.isInteger(point.collected_paise)).toBe(true)
        expect(Number.isInteger(point.expected_paise)).toBe(true)
        expect(Number.isInteger(point.forecast_low_paise)).toBe(true)
        expect(Number.isInteger(point.forecast_high_paise)).toBe(true)
      })
    })

    it('past months have tight bounds (forecast_low = forecast_high = expected)', () => {
      const forecast = financeForecast(opts)
      forecast.slice(0, 6).forEach((point) => {
        expect(point.forecast_low_paise).toBe(point.expected_paise)
        expect(point.forecast_high_paise).toBe(point.expected_paise)
      })
    })

    it('future months have widening bands', () => {
      const forecast = financeForecast(opts)
      const future = forecast.slice(6, 12)
      for (let i = 0; i < future.length - 1; i++) {
        const bandWidth = future[i].forecast_high_paise - future[i].forecast_low_paise
        const nextBandWidth = future[i + 1].forecast_high_paise - future[i + 1].forecast_low_paise
        expect(nextBandWidth).toBeGreaterThan(bandWidth)
      }
    })

    it('deterministic: same seed produces same output', () => {
      const forecast1 = financeForecast(opts)
      const forecast2 = financeForecast(opts)
      expect(forecast1).toEqual(forecast2)
    })
  })

  describe('outstandingAlerts', () => {
    it('returns 25 outstanding alerts', () => {
      const alerts = outstandingAlerts(opts)
      expect(alerts).toHaveLength(25)
    })

    it('days_overdue is between 5 and 120', () => {
      const alerts = outstandingAlerts(opts)
      alerts.forEach((alert) => {
        expect(alert.days_overdue).toBeGreaterThanOrEqual(5)
        expect(alert.days_overdue).toBeLessThanOrEqual(120)
      })
    })

    it('outstanding_paise are integers', () => {
      const alerts = outstandingAlerts(opts)
      alerts.forEach((alert) => {
        expect(Number.isInteger(alert.outstanding_paise)).toBe(true)
      })
    })

    it('some alerts have concessions', () => {
      const alerts = outstandingAlerts(opts)
      const withConcession = alerts.filter((a) => a.concession).length
      expect(withConcession).toBeGreaterThan(0)
      expect(withConcession).toBeLessThan(25)
    })

    it('each alert has a unique student_id', () => {
      const alerts = outstandingAlerts(opts)
      const ids = alerts.map((a) => a.student_id)
      const unique = new Set(ids)
      expect(unique.size).toBe(25)
    })

    it('deterministic: same seed produces same output', () => {
      const alerts1 = outstandingAlerts(opts)
      const alerts2 = outstandingAlerts(opts)
      expect(alerts1).toEqual(alerts2)
    })
  })

  describe('budgetLines', () => {
    it('returns 10 budget categories', () => {
      const lines = budgetLines(opts)
      expect(lines).toHaveLength(10)
    })

    it('all categories are named', () => {
      const lines = budgetLines(opts)
      lines.forEach((line) => {
        expect(line.category).toMatch(/^[A-Za-z\s]+$/)
        expect(line.category.length).toBeGreaterThan(0)
      })
    })

    it('all amounts are integers (paise)', () => {
      const lines = budgetLines(opts)
      lines.forEach((line) => {
        expect(Number.isInteger(line.budget_paise)).toBe(true)
        expect(Number.isInteger(line.actual_paise)).toBe(true)
        expect(Number.isInteger(line.variance_pct)).toBe(true)
      })
    })

    it('variance_pct = ((actual - budget) / budget) * 100', () => {
      const lines = budgetLines(opts)
      lines.forEach((line) => {
        const expectedVariance = Math.round(((line.actual_paise - line.budget_paise) / line.budget_paise) * 100)
        expect(line.variance_pct).toBe(expectedVariance)
      })
    })

    it('deterministic: same seed produces same output', () => {
      const lines1 = budgetLines(opts)
      const lines2 = budgetLines(opts)
      expect(lines1).toEqual(lines2)
    })

    it('different seed produces different output', () => {
      const opts2 = { ...opts, seed: 999 }
      const lines1 = budgetLines(opts)
      const lines2 = budgetLines(opts2)
      expect(lines1).not.toEqual(lines2)
    })
  })
})
