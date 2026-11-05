import { describe, it, expect } from 'vitest'
import {
  LateFeeRuleUpsertSchema,
  SetInstalmentsSchema,
  LateFeeRulesQuerySchema,
  InstalmentsQuerySchema,
  LedgerExportSchema,
} from '@/modules/fee-plans/schemas'

const testUuid = '550e8400-e29b-41d4-a716-446655440000'

describe('LateFeeRuleUpsertSchema', () => {
  it('accepts valid flat rule with defaults', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'flat',
      amount: 250.5,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.graceDays).toBe(0)
      expect(result.data.isActive).toBe(true)
      expect(result.data.cap).toBeUndefined()
    }
  })

  it('accepts valid per_day rule with cap', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'per_day',
      amount: 10.5,
      graceDays: 5,
      cap: 100.0,
      isActive: false,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cap).toBe(100.0)
    }
  })

  it('rejects per_day without cap', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'per_day',
      amount: 10,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects per_day with cap < amount', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'per_day',
      amount: 20,
      cap: 15,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects flat rule with cap', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'flat',
      amount: 250,
      cap: 300,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects amount < 1', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'flat',
      amount: 0.5,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects amount with > 2 decimals', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'flat',
      amount: 10.005,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects amount > 100000', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'flat',
      amount: 100001,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects graceDays < 0', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'flat',
      amount: 250,
      graceDays: -1,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects graceDays > 90', () => {
    const input = {
      feeStructureId: testUuid,
      kind: 'flat',
      amount: 250,
      graceDays: 91,
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects unknown keys', () => {
    const input: Record<string, unknown> = {
      feeStructureId: testUuid,
      kind: 'flat',
      amount: 250,
      unknownKey: 'value',
    }
    const result = LateFeeRuleUpsertSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('SetInstalmentsSchema', () => {
  it('accepts valid 3-part plan', () => {
    const input = {
      invoiceId: testUuid,
      parts: [
        { dueOn: '2026-11-15', amount: 5000.0 },
        { dueOn: '2026-12-10', amount: 5000.0 },
        { dueOn: '2027-01-15', amount: 5000.01 },
      ],
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('accepts minimum 2 parts', () => {
    const input = {
      invoiceId: testUuid,
      parts: [
        { dueOn: '2026-11-15', amount: 7500.0 },
        { dueOn: '2026-12-10', amount: 7500.0 },
      ],
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('accepts maximum 12 parts', () => {
    const input = {
      invoiceId: testUuid,
      parts: Array.from({ length: 12 }, (_, i) => ({
        dueOn: new Date(Date.UTC(2026, 10 + i, 15)).toISOString().slice(0, 10),
        amount: 100.0,
      })),
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects 1 part', () => {
    const input = {
      invoiceId: testUuid,
      parts: [{ dueOn: '2026-11-15', amount: 15000.0 }],
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects 13 parts', () => {
    const input = {
      invoiceId: testUuid,
      parts: Array.from({ length: 13 }, (_, i) => ({
        dueOn: `2026-${String(11 + i).padStart(2, '0')}-15`,
        amount: 100.0,
      })),
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects equal dates', () => {
    const input = {
      invoiceId: testUuid,
      parts: [
        { dueOn: '2026-11-15', amount: 7500.0 },
        { dueOn: '2026-11-15', amount: 7500.0 },
      ],
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects decreasing dates', () => {
    const input = {
      invoiceId: testUuid,
      parts: [
        { dueOn: '2026-12-10', amount: 7500.0 },
        { dueOn: '2026-11-15', amount: 7500.0 },
      ],
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects amount < 1', () => {
    const input = {
      invoiceId: testUuid,
      parts: [
        { dueOn: '2026-11-15', amount: 0.5 },
        { dueOn: '2026-12-10', amount: 7500.0 },
      ],
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects amount with > 2 decimals', () => {
    const input = {
      invoiceId: testUuid,
      parts: [
        { dueOn: '2026-11-15', amount: 7500.005 },
        { dueOn: '2026-12-10', amount: 7500.0 },
      ],
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects unknown keys', () => {
    const input: Record<string, unknown> = {
      invoiceId: testUuid,
      parts: [
        { dueOn: '2026-11-15', amount: 7500.0, unknownKey: 'value' },
        { dueOn: '2026-12-10', amount: 7500.0 },
      ],
    }
    const result = SetInstalmentsSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('LateFeeRulesQuerySchema', () => {
  it('accepts empty object', () => {
    const input = {}
    const result = LateFeeRulesQuerySchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects unknown keys', () => {
    const input: Record<string, unknown> = { unknownKey: 'value' }
    const result = LateFeeRulesQuerySchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('InstalmentsQuerySchema', () => {
  it('accepts valid invoiceId', () => {
    const input = { invoiceId: testUuid }
    const result = InstalmentsQuerySchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects invalid UUID', () => {
    const input = { invoiceId: 'not-a-uuid' }
    const result = InstalmentsQuerySchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects missing invoiceId', () => {
    const input = {}
    const result = InstalmentsQuerySchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects unknown keys', () => {
    const input: Record<string, unknown> = { invoiceId: testUuid, unknownKey: 'value' }
    const result = InstalmentsQuerySchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('LedgerExportSchema', () => {
  it('accepts minimal input with defaults', () => {
    const input = {
      from: '2026-11-01',
      to: '2026-11-30',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.layout).toBe('plain')
      expect(result.data.include).toBe('receipts')
    }
  })

  it('accepts all fields', () => {
    const input = {
      from: '2026-11-01',
      to: '2026-11-30',
      layout: 'tally',
      include: 'all',
      cashLedger: 'Cash on Hand',
      bankLedger: 'Bank',
      receivableLedger: 'Fees Receivable',
      incomeLedger: 'Fee Income',
      lateFeeLedger: 'Late Fee Income',
      concessionLedger: 'Fee Concession',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('trims ledger name strings', () => {
    const input = {
      from: '2026-11-01',
      to: '2026-11-30',
      cashLedger: '  Cash  ',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cashLedger).toBe('Cash')
    }
  })

  it('rejects ledger name > 100 chars', () => {
    const input = {
      from: '2026-11-01',
      to: '2026-11-30',
      cashLedger: 'a'.repeat(101),
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects to < from', () => {
    const input = {
      from: '2026-11-30',
      to: '2026-11-01',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('accepts 366-day span', () => {
    const input = {
      from: '2026-01-01',
      to: '2027-01-01',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects 367-day span', () => {
    const input = {
      from: '2026-01-01',
      to: '2027-01-02',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects invalid date format', () => {
    const input = {
      from: '01-11-2026',
      to: '2026-11-30',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects unknown layout', () => {
    const input: Record<string, unknown> = {
      from: '2026-11-01',
      to: '2026-11-30',
      layout: 'xml',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects unknown include', () => {
    const input: Record<string, unknown> = {
      from: '2026-11-01',
      to: '2026-11-30',
      include: 'payments',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects unknown keys', () => {
    const input: Record<string, unknown> = {
      from: '2026-11-01',
      to: '2026-11-30',
      unknownKey: 'value',
    }
    const result = LedgerExportSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})
