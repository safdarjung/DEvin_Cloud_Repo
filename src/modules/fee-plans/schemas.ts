// X04-T3 — fee-plans module schemas. Late fee rules, instalment plans, ledger
// export. All schemas `.strict()` per CLAUDE.md rule 4.
import { z } from 'zod'
import { money, uuid, isoDate } from '../../lib/schemas/common.ts'

export const LateFeeRuleUpsertSchema = z
  .object({
    feeStructureId: uuid,
    kind: z.enum(['flat', 'per_day']),
    amount: money.gte(1).lte(100000),
    graceDays: z.number().int().min(0).max(90).default(0),
    cap: money.gte(1).lte(1000000).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine(
    (data) => {
      if (data.kind === 'per_day') {
        return data.cap != null && data.cap >= data.amount
      }
      return data.cap == null
    },
    {
      message: 'Invalid cap for this kind',
      path: ['cap'],
    },
  )

export type LateFeeRuleUpsertInput = z.infer<typeof LateFeeRuleUpsertSchema>

const InstallmentPartSchema = z
  .object({
    dueOn: isoDate,
    amount: money.gte(1),
  })
  .strict()

export const SetInstalmentsSchema = z
  .object({
    invoiceId: uuid,
    parts: z.array(InstallmentPartSchema).min(2).max(12),
  })
  .strict()
  .refine(
    (data) => {
      for (let i = 1; i < data.parts.length; i++) {
        if (data.parts[i].dueOn <= data.parts[i - 1].dueOn) {
          return false
        }
      }
      return true
    },
    {
      message: 'Instalment due dates must be strictly increasing',
      path: ['parts'],
    },
  )

export type SetInstalmentsInput = z.infer<typeof SetInstalmentsSchema>

export const LateFeeRulesQuerySchema = z.object({}).strict()

export type LateFeeRulesQueryInput = z.infer<typeof LateFeeRulesQuerySchema>

export const InstalmentsQuerySchema = z
  .object({
    invoiceId: uuid,
  })
  .strict()

export type InstalmentsQueryInput = z.infer<typeof InstalmentsQuerySchema>

export const LedgerExportSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    layout: z.enum(['plain', 'tally']).default('plain'),
    include: z.enum(['receipts', 'all']).default('receipts'),
    cashLedger: z.string().trim().min(1).max(100).optional(),
    bankLedger: z.string().trim().min(1).max(100).optional(),
    receivableLedger: z.string().trim().min(1).max(100).optional(),
    incomeLedger: z.string().trim().min(1).max(100).optional(),
    lateFeeLedger: z.string().trim().min(1).max(100).optional(),
    concessionLedger: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (data) => {
      const from = new Date(data.from)
      const to = new Date(data.to)
      return from <= to
    },
    {
      message: 'from must be ≤ to',
      path: ['to'],
    },
  )
  .refine(
    (data) => {
      const from = new Date(data.from)
      const to = new Date(data.to)
      // Inclusive span: from === to is a 1-day span.
      const daysDiff =
        Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1
      return daysDiff <= 366
    },
    {
      message: 'Date range must not exceed 366 days',
      path: ['to'],
    },
  )

export type LedgerExportInput = z.infer<typeof LedgerExportSchema>
