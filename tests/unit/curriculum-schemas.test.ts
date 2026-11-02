import { describe, it, expect } from 'vitest'
import {
  CurriculumUnitUpsertSchema,
  LessonPlanUpsertSchema,
  LessonPlanDeleteSchema,
  MarkCoveredSchema,
  CoverageQuerySchema,
  SectionUnitsQuerySchema,
  LessonPlansQuerySchema,
} from '@/modules/academics/curriculum.schemas'

describe('Curriculum Schemas', () => {
  // CurriculumUnitUpsertSchema tests
  describe('CurriculumUnitUpsertSchema', () => {
    it('parses valid unit upsert input', () => {
      const valid = {
        gradeId: '550e8400-e29b-41d4-a716-446655440000',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        title: 'Quadratic Equations',
        description: 'An introduction to quadratic equations',
        sequence: 1,
      }
      expect(() => CurriculumUnitUpsertSchema.parse(valid)).not.toThrow()
    })

    it('parses valid unit update with id', () => {
      const valid = {
        id: '550e8400-e29b-41d4-a716-446655440002',
        gradeId: '550e8400-e29b-41d4-a716-446655440000',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        title: 'Updated Title',
        sequence: 2,
      }
      expect(() => CurriculumUnitUpsertSchema.parse(valid)).not.toThrow()
    })

    it('rejects title over 120 chars', () => {
      const invalid = {
        gradeId: '550e8400-e29b-41d4-a716-446655440000',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        title: 'a'.repeat(121),
        sequence: 1,
      }
      expect(() => CurriculumUnitUpsertSchema.parse(invalid)).toThrow()
    })

    it('rejects description over 2000 chars', () => {
      const invalid = {
        gradeId: '550e8400-e29b-41d4-a716-446655440000',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        title: 'Valid Title',
        description: 'a'.repeat(2001),
        sequence: 1,
      }
      expect(() => CurriculumUnitUpsertSchema.parse(invalid)).toThrow()
    })

    it('rejects sequence 0', () => {
      const invalid = {
        gradeId: '550e8400-e29b-41d4-a716-446655440000',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        title: 'Valid Title',
        sequence: 0,
      }
      expect(() => CurriculumUnitUpsertSchema.parse(invalid)).toThrow()
    })

    it('rejects sequence over 200', () => {
      const invalid = {
        gradeId: '550e8400-e29b-41d4-a716-446655440000',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        title: 'Valid Title',
        sequence: 201,
      }
      expect(() => CurriculumUnitUpsertSchema.parse(invalid)).toThrow()
    })

    it('rejects unknown keys', () => {
      const invalid = {
        gradeId: '550e8400-e29b-41d4-a716-446655440000',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        title: 'Valid Title',
        sequence: 1,
        extraField: 'should fail',
      }
      expect(() => CurriculumUnitUpsertSchema.parse(invalid)).toThrow()
    })

    it('trims whitespace from title', () => {
      const input = {
        gradeId: '550e8400-e29b-41d4-a716-446655440000',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        title: '  Trimmed Title  ',
        sequence: 1,
      }
      const result = CurriculumUnitUpsertSchema.parse(input)
      expect(result.title).toBe('Trimmed Title')
    })
  })

  // LessonPlanUpsertSchema tests
  describe('LessonPlanUpsertSchema', () => {
    it('parses valid lesson plan insert', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        curriculumUnitId: '550e8400-e29b-41d4-a716-446655440004',
        plannedOn: '2026-07-15',
        title: 'Introduction to Quadratic Equations',
        objectives: 'Students will understand quadratic equations',
      }
      expect(() => LessonPlanUpsertSchema.parse(valid)).not.toThrow()
    })

    it('parses lesson plan with null curriculumUnitId', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        curriculumUnitId: null,
        plannedOn: '2026-07-15',
        title: 'Revision Lesson',
        objectives: 'Review previous topics',
      }
      expect(() => LessonPlanUpsertSchema.parse(valid)).not.toThrow()
    })

    it('parses lesson plan update with id', () => {
      const valid = {
        id: '550e8400-e29b-41d4-a716-446655440005',
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        plannedOn: '2026-07-15',
        title: 'Updated Plan',
        objectives: 'Updated objectives',
      }
      expect(() => LessonPlanUpsertSchema.parse(valid)).not.toThrow()
    })

    it('rejects title over 120 chars', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        plannedOn: '2026-07-15',
        title: 'a'.repeat(121),
        objectives: 'Valid objectives',
      }
      expect(() => LessonPlanUpsertSchema.parse(invalid)).toThrow()
    })

    it('rejects objectives over 2000 chars', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        plannedOn: '2026-07-15',
        title: 'Valid Title',
        objectives: 'a'.repeat(2001),
      }
      expect(() => LessonPlanUpsertSchema.parse(invalid)).toThrow()
    })

    it('rejects resources over 2000 chars', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        plannedOn: '2026-07-15',
        title: 'Valid Title',
        objectives: 'Valid objectives',
        resources: 'a'.repeat(2001),
      }
      expect(() => LessonPlanUpsertSchema.parse(invalid)).toThrow()
    })

    it('rejects invalid ISO date', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        plannedOn: '2026-13-01',
        title: 'Valid Title',
        objectives: 'Valid objectives',
      }
      expect(() => LessonPlanUpsertSchema.parse(invalid)).toThrow()
    })

    it('rejects unknown keys', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        plannedOn: '2026-07-15',
        title: 'Valid Title',
        objectives: 'Valid objectives',
        extraField: 'should fail',
      }
      expect(() => LessonPlanUpsertSchema.parse(invalid)).toThrow()
    })

    it('trims whitespace from title and objectives', () => {
      const input = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        plannedOn: '2026-07-15',
        title: '  Trimmed Title  ',
        objectives: '  Trimmed Objectives  ',
      }
      const result = LessonPlanUpsertSchema.parse(input)
      expect(result.title).toBe('Trimmed Title')
      expect(result.objectives).toBe('Trimmed Objectives')
    })
  })

  // LessonPlanDeleteSchema tests
  describe('LessonPlanDeleteSchema', () => {
    it('parses valid delete input', () => {
      const valid = {
        id: '550e8400-e29b-41d4-a716-446655440005',
      }
      expect(() => LessonPlanDeleteSchema.parse(valid)).not.toThrow()
    })

    it('rejects invalid uuid', () => {
      const invalid = {
        id: 'not-a-uuid',
      }
      expect(() => LessonPlanDeleteSchema.parse(invalid)).toThrow()
    })

    it('rejects unknown keys', () => {
      const invalid = {
        id: '550e8400-e29b-41d4-a716-446655440005',
        extraField: 'should fail',
      }
      expect(() => LessonPlanDeleteSchema.parse(invalid)).toThrow()
    })
  })

  // MarkCoveredSchema tests
  describe('MarkCoveredSchema', () => {
    it('parses valid coverage mark with covered true and coveredOn', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        curriculumUnitId: '550e8400-e29b-41d4-a716-446655440004',
        covered: true,
        coveredOn: '2026-07-15',
      }
      expect(() => MarkCoveredSchema.parse(valid)).not.toThrow()
    })

    it('rejects covered true without coveredOn', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        curriculumUnitId: '550e8400-e29b-41d4-a716-446655440004',
        covered: true,
      }
      expect(() => MarkCoveredSchema.parse(invalid)).toThrow()
    })

    it('parses valid coverage mark with covered false', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        curriculumUnitId: '550e8400-e29b-41d4-a716-446655440004',
        covered: false,
      }
      expect(() => MarkCoveredSchema.parse(valid)).not.toThrow()
    })

    it('parses coverage with optional lessonPlanId and notes', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        curriculumUnitId: '550e8400-e29b-41d4-a716-446655440004',
        covered: true,
        coveredOn: '2026-07-15',
        lessonPlanId: '550e8400-e29b-41d4-a716-446655440005',
        notes: 'Students understood the concept well',
      }
      expect(() => MarkCoveredSchema.parse(valid)).not.toThrow()
    })

    it('rejects notes over 500 chars', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        curriculumUnitId: '550e8400-e29b-41d4-a716-446655440004',
        covered: true,
        coveredOn: '2026-07-15',
        notes: 'a'.repeat(501),
      }
      expect(() => MarkCoveredSchema.parse(invalid)).toThrow()
    })

    it('rejects invalid ISO date for coveredOn', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        curriculumUnitId: '550e8400-e29b-41d4-a716-446655440004',
        covered: true,
        coveredOn: '2026-13-01',
      }
      expect(() => MarkCoveredSchema.parse(invalid)).toThrow()
    })

    it('rejects unknown keys', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        curriculumUnitId: '550e8400-e29b-41d4-a716-446655440004',
        covered: true,
        coveredOn: '2026-07-15',
        extraField: 'should fail',
      }
      expect(() => MarkCoveredSchema.parse(invalid)).toThrow()
    })

    it('trims whitespace from notes', () => {
      const input = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        curriculumUnitId: '550e8400-e29b-41d4-a716-446655440004',
        covered: true,
        coveredOn: '2026-07-15',
        notes: '  Trimmed Notes  ',
      }
      const result = MarkCoveredSchema.parse(input)
      expect(result.notes).toBe('Trimmed Notes')
    })
  })

  // CoverageQuerySchema tests
  describe('CoverageQuerySchema', () => {
    it('parses valid coverage query', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
      }
      expect(() => CoverageQuerySchema.parse(valid)).not.toThrow()
    })

    it('parses coverage query with only classSectionId', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
      }
      expect(() => CoverageQuerySchema.parse(valid)).not.toThrow()
    })

    it('parses coverage query with only subjectId', () => {
      const valid = {
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
      }
      expect(() => CoverageQuerySchema.parse(valid)).not.toThrow()
    })

    it('parses empty coverage query', () => {
      const valid = {}
      expect(() => CoverageQuerySchema.parse(valid)).not.toThrow()
    })

    it('rejects unknown keys', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        extraField: 'should fail',
      }
      expect(() => CoverageQuerySchema.parse(invalid)).toThrow()
    })
  })

  // SectionUnitsQuerySchema tests
  describe('SectionUnitsQuerySchema', () => {
    it('parses valid section units query', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
      }
      expect(() => SectionUnitsQuerySchema.parse(valid)).not.toThrow()
    })

    it('rejects missing classSectionId', () => {
      const invalid = {
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
      }
      expect(() => SectionUnitsQuerySchema.parse(invalid)).toThrow()
    })

    it('rejects missing subjectId', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
      }
      expect(() => SectionUnitsQuerySchema.parse(invalid)).toThrow()
    })

    it('rejects unknown keys', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        extraField: 'should fail',
      }
      expect(() => SectionUnitsQuerySchema.parse(invalid)).toThrow()
    })
  })

  // LessonPlansQuerySchema tests
  describe('LessonPlansQuerySchema', () => {
    it('parses valid lesson plans query with required classSectionId', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
      }
      expect(() => LessonPlansQuerySchema.parse(valid)).not.toThrow()
    })

    it('parses lesson plans query with optional filters', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
        from: '2026-07-01',
        to: '2026-07-31',
      }
      expect(() => LessonPlansQuerySchema.parse(valid)).not.toThrow()
    })

    it('rejects from after to', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        from: '2026-07-31',
        to: '2026-07-01',
      }
      expect(() => LessonPlansQuerySchema.parse(invalid)).toThrow()
    })

    it('allows from equal to to', () => {
      const valid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        from: '2026-07-15',
        to: '2026-07-15',
      }
      expect(() => LessonPlansQuerySchema.parse(valid)).not.toThrow()
    })

    it('rejects missing classSectionId', () => {
      const invalid = {
        subjectId: '550e8400-e29b-41d4-a716-446655440001',
      }
      expect(() => LessonPlansQuerySchema.parse(invalid)).toThrow()
    })

    it('rejects invalid ISO date for from', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        from: '2026-13-01',
      }
      expect(() => LessonPlansQuerySchema.parse(invalid)).toThrow()
    })

    it('rejects unknown keys', () => {
      const invalid = {
        classSectionId: '550e8400-e29b-41d4-a716-446655440003',
        extraField: 'should fail',
      }
      expect(() => LessonPlansQuerySchema.parse(invalid)).toThrow()
    })
  })
})
