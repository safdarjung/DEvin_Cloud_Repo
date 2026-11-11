import { describe, it, expect } from 'vitest'
import {
  SubstitutionAssignSchema,
  SubstitutionCancelSchema,
  SubstitutionCandidatesSchema,
  CoverNeededSchema,
  SubstitutionsSchema,
} from '../../src/modules/timetable/schemas'
import {
  MarkPeriodAttendanceSchema,
  PeriodSummarySchema,
} from '../../src/modules/attendance/schemas'

const validUuid = '550e8400-e29b-41d4-a716-446655440000'

describe('M08 Timetable Substitution Schemas', () => {
  describe('SubstitutionAssignSchema', () => {
    it('parses valid assign input (0141: the reason note is required)', () => {
      const input = {
        slotId: validUuid,
        date: '2025-01-15',
        substituteId: validUuid,
        note: 'Ms Iyer is on leave',
      }
      const result = SubstitutionAssignSchema.safeParse(input)
      expect(result.success).toBe(true)
      expect(result.data).toEqual(input)
      expect(SubstitutionAssignSchema.safeParse({ ...input, note: undefined }).success).toBe(false)
      expect(SubstitutionAssignSchema.safeParse({ ...input, note: '   ' }).success).toBe(false)
    })

    it('parses with optional leaveRequestId and note', () => {
      const input = {
        slotId: validUuid,
        date: '2025-01-15',
        substituteId: validUuid,
        leaveRequestId: validUuid,
        note: 'Cover for approved leave',
      }
      const result = SubstitutionAssignSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('rejects invalid date format', () => {
      const input = {
        slotId: validUuid,
        date: '2025/01/15',
        substituteId: validUuid,
      }
      const result = SubstitutionAssignSchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('rejects note exceeding 200 chars', () => {
      const input = {
        slotId: validUuid,
        date: '2025-01-15',
        substituteId: validUuid,
        note: 'x'.repeat(201),
      }
      const result = SubstitutionAssignSchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('rejects unknown keys', () => {
      const input = {
        slotId: validUuid,
        date: '2025-01-15',
        substituteId: validUuid,
        extraField: 'should fail',
      }
      const result = SubstitutionAssignSchema.safeParse(input)
      expect(result.success).toBe(false)
    })
  })

  describe('SubstitutionCancelSchema', () => {
    it('parses valid cancel input', () => {
      const input = { substitutionId: validUuid }
      const result = SubstitutionCancelSchema.safeParse(input)
      expect(result.success).toBe(true)
      expect(result.data).toEqual(input)
    })

    it('rejects unknown keys', () => {
      const input = {
        substitutionId: validUuid,
        reason: 'cancelled',
      }
      const result = SubstitutionCancelSchema.safeParse(input)
      expect(result.success).toBe(false)
    })
  })

  describe('SubstitutionCandidatesSchema', () => {
    it('parses valid candidates query', () => {
      const input = {
        slotId: validUuid,
        date: '2025-01-15',
      }
      const result = SubstitutionCandidatesSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('rejects invalid date', () => {
      const input = {
        slotId: validUuid,
        date: 'invalid',
      }
      const result = SubstitutionCandidatesSchema.safeParse(input)
      expect(result.success).toBe(false)
    })
  })

  describe('CoverNeededSchema', () => {
    it('parses with optional date', () => {
      const result = CoverNeededSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('parses with valid date', () => {
      const result = CoverNeededSchema.safeParse({ date: '2025-01-15' })
      expect(result.success).toBe(true)
    })

    it('rejects invalid date', () => {
      const result = CoverNeededSchema.safeParse({ date: 'bad' })
      expect(result.success).toBe(false)
    })
  })

  describe('SubstitutionsSchema', () => {
    it('parses with optional date', () => {
      const result = SubstitutionsSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('parses with valid date', () => {
      const result = SubstitutionsSchema.safeParse({ date: '2025-01-15' })
      expect(result.success).toBe(true)
    })
  })
})

describe('M08 Attendance Period Schemas', () => {
  describe('MarkPeriodAttendanceSchema', () => {
    it('parses valid period attendance input', () => {
      const input = {
        classSectionId: validUuid,
        periodId: validUuid,
        date: '2025-01-15',
        records: [
          { studentId: validUuid, status: 'present' },
          { studentId: validUuid, status: 'absent', note: 'sick' },
        ],
      }
      const result = MarkPeriodAttendanceSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('parses with max 200 records', () => {
      const records = Array.from({ length: 200 }, () => ({
        studentId: validUuid,
        status: 'present',
      }))
      const input = {
        classSectionId: validUuid,
        periodId: validUuid,
        date: '2025-01-15',
        records,
      }
      const result = MarkPeriodAttendanceSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('rejects 201 records', () => {
      const records = Array.from({ length: 201 }, () => ({
        studentId: validUuid,
        status: 'present',
      }))
      const input = {
        classSectionId: validUuid,
        periodId: validUuid,
        date: '2025-01-15',
        records,
      }
      const result = MarkPeriodAttendanceSchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('rejects note exceeding 200 chars', () => {
      const input = {
        classSectionId: validUuid,
        periodId: validUuid,
        date: '2025-01-15',
        records: [
          {
            studentId: validUuid,
            status: 'absent',
            note: 'x'.repeat(201),
          },
        ],
      }
      const result = MarkPeriodAttendanceSchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('rejects bad date', () => {
      const input = {
        classSectionId: validUuid,
        periodId: validUuid,
        date: 'not-a-date',
        records: [{ studentId: validUuid, status: 'present' }],
      }
      const result = MarkPeriodAttendanceSchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('rejects unknown keys', () => {
      const input = {
        classSectionId: validUuid,
        periodId: validUuid,
        date: '2025-01-15',
        records: [{ studentId: validUuid, status: 'present' }],
        unknownField: 'should fail',
      }
      const result = MarkPeriodAttendanceSchema.safeParse(input)
      expect(result.success).toBe(false)
    })
  })

  describe('PeriodSummarySchema', () => {
    it('parses with required classSectionId and date', () => {
      const input = {
        classSectionId: validUuid,
        date: '2025-01-15',
      }
      const result = PeriodSummarySchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('rejects invalid date', () => {
      const input = {
        classSectionId: validUuid,
        date: 'invalid',
      }
      const result = PeriodSummarySchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('rejects unknown keys', () => {
      const input = {
        classSectionId: validUuid,
        date: '2025-01-15',
        extra: true,
      }
      const result = PeriodSummarySchema.safeParse(input)
      expect(result.success).toBe(false)
    })
  })
})
