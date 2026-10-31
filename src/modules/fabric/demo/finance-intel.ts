import {
  FinanceForecastPoint,
  OutstandingAlert,
  BudgetLine,
  ISODate,
} from '../types'
import { rng, FixtureOpts, isoDate, INDIAN_FIRST_NAMES, INDIAN_LAST_NAMES, SECTION_LABELS } from './prng'

export function financeForecast(opts: FixtureOpts): FinanceForecastPoint[] {
  const r = rng(opts.seed ?? 7)
  const result: FinanceForecastPoint[] = []

  // ~1,800 students, ~₹2,400/month average fee = ₹43.2M/month total expected revenue (in paise: 4,320,000,000)
  const expectedMonthlyPaise = 432_000_000 // ₹4.32 crore

  // 6 past months + 6 future months, centred on opts.now
  for (let i = -6; i <= 5; i++) {
    const monthDate = new Date(opts.now)
    monthDate.setMonth(monthDate.getMonth() + i)
    const month = isoDate(monthDate).slice(0, 7) // "2026-11"

    let collected: number
    let expected: number
    let forecastLow: number
    let forecastHigh: number

    if (i < 0) {
      // Past months: collected > 0, typical 75-95% collection
      collected = Math.round(expectedMonthlyPaise * r.int(75, 95) / 100)
      expected = expectedMonthlyPaise
      forecastLow = expected
      forecastHigh = expected
    } else {
      // Future months: collected = 0, widening bands
      collected = 0
      expected = expectedMonthlyPaise
      const widthFactor = (i + 1) * 5 // 5%, 10%, 15%, ... as we go further out
      forecastLow = Math.round(expectedMonthlyPaise * (100 - widthFactor) / 100)
      forecastHigh = Math.round(expectedMonthlyPaise * (100 + widthFactor) / 100)
    }

    result.push({
      month,
      collected_paise: collected,
      expected_paise: expected,
      forecast_low_paise: forecastLow,
      forecast_high_paise: forecastHigh,
    })
  }

  return result
}

export function outstandingAlerts(opts: FixtureOpts): OutstandingAlert[] {
  const r = rng((opts.seed ?? 7) + 1)
  const result: OutstandingAlert[] = []

  const studentCount = 25
  for (let i = 0; i < studentCount; i++) {
    const firstName = r.pick(INDIAN_FIRST_NAMES)
    const lastName = r.pick(INDIAN_LAST_NAMES)
    const name = `${firstName} ${lastName}`
    const sectionLabel = r.pick(SECTION_LABELS)
    const daysOverdue = r.int(5, 120)
    const outstanding = Math.round(r.int(50_000, 500_000) / 1000) * 1000 // Round to nearest ₹1000 (100,000 paise)
    const hasConcession = r.chance(0.15) // 15% with concessions
    const monthsAgo = Math.floor(daysOverdue / 30)

    let lastReminder: ISODate | null = null
    if (monthsAgo > 0) {
      const reminderDate = new Date(opts.now)
      reminderDate.setDate(reminderDate.getDate() - daysOverdue + 7) // reminder ~7 days after first overdue
      lastReminder = isoDate(reminderDate)
    }

    result.push({
      student_id: r.id('stu', i),
      name,
      section_label: sectionLabel,
      outstanding_paise: outstanding,
      days_overdue: daysOverdue,
      last_reminder: lastReminder,
      concession: hasConcession,
    })
  }

  return result
}

export function budgetLines(opts: FixtureOpts): BudgetLine[] {
  const r = rng((opts.seed ?? 7) + 2)

  const categories = [
    'Salaries',
    'Transport',
    'Maintenance',
    'Utilities',
    'Lab Equipment',
    'Library',
    'Sports',
    'Events',
    'IT Infrastructure',
    'Administration',
  ] as const

  // Annual budget: ~₹15 crore = 1,500,000,000 paise total
  const totalBudget = 1_500_000_000
  const budgetPerCategory = totalBudget / categories.length

  return categories.map((category) => {
    const budgetPaise = Math.round(budgetPerCategory + r.int(-50_000_000, 50_000_000)) // ±₹5L variance per category
    const actualSpent = Math.round(budgetPaise * r.int(75, 115) / 100) // 75%-115% of budget
    const variancePct = Math.round(((actualSpent - budgetPaise) / budgetPaise) * 100)

    return {
      category: category as string,
      budget_paise: budgetPaise,
      actual_paise: actualSpent,
      variance_pct: variancePct,
    }
  })
}
