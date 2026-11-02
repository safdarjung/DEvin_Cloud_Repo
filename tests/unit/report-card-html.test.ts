import { describe, it, expect } from 'vitest'
import { escapeHtml, renderReportCardHtml } from '@/modules/exams/report-card-html'
import type { ResultDetail } from '@/modules/exams/queries'

const mockResult: ResultDetail = {
  id: 'result-1',
  examId: 'exam-1',
  examName: 'Mid-Term Exam',
  examType: 'half_yearly',
  studentId: 'student-1',
  studentName: 'Alice Johnson',
  admissionNo: 'ADM001',
  versionNo: 1,
  total: 85,
  maxTotal: 100,
  percentage: 85.0,
  grade: 'A',
  attendancePercentage: 95,
  publishedAt: '2026-11-02T10:00:00Z',
  isCorrected: false,
  subjects: [
    {
      examPaperId: 'paper-1',
      subjectId: 'subj-1',
      subjectName: 'English',
      marksObtained: 85,
      maxMarks: 100,
      isAbsent: false,
      passed: true,
      grade: 'A',
    },
    {
      examPaperId: 'paper-2',
      subjectId: 'subj-2',
      subjectName: 'Mathematics',
      marksObtained: 90,
      maxMarks: 100,
      isAbsent: false,
      passed: true,
      grade: 'A+',
    },
    {
      examPaperId: 'paper-3',
      subjectId: 'subj-3',
      subjectName: 'Science',
      marksObtained: null,
      maxMarks: 100,
      isAbsent: true,
      passed: false,
      grade: null,
    },
  ],
}

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escapeHtml('Hello & goodbye')).toBe('Hello &amp; goodbye')
    expect(escapeHtml('Quote " and apostrophe \'')).toBe('Quote &quot; and apostrophe &#x27;')
  })

  it('handles plain text unchanged', () => {
    expect(escapeHtml('Alice Johnson')).toBe('Alice Johnson')
  })
})

describe('renderReportCardHtml', () => {
  it('produces valid HTML5 document', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('</html>')
    expect(html).not.toContain('<script')
  })

  it('includes title with student name and exam name', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).toContain('<title>Alice Johnson — Mid-Term Exam</title>')
  })

  it('escapes student name in HTML', () => {
    const resultWithXss = {
      ...mockResult,
      studentName: '<script>alert(1)</script>',
    }
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: resultWithXss,
      remark: null,
    })

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('shows absent subject as AB', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    // Science paper is absent
    expect(html).toMatch(/Science[\s\S]*?AB/)
  })

  it('includes subject table with marks', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).toContain('English')
    expect(html).toContain('Mathematics')
    expect(html).toContain('85')
    expect(html).toContain('90')
  })

  it('includes total, percentage and attendance', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).toContain('85') // total
    expect(html).toContain('100') // max total
    expect(html).toContain('85.0') // percentage with 1 dp
    expect(html).toContain('95') // attendance
  })

  it('includes remark when provided', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: 'Excellent performance',
    })

    expect(html).toContain('Excellent performance')
  })

  it('excludes remark when null', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).not.toContain("Teacher's remark")
  })

  it('includes corrected note when isCorrected is true', () => {
    const correctedResult = { ...mockResult, isCorrected: true, publishedAt: '2026-11-03T10:00:00Z' }
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: correctedResult,
      remark: null,
    })

    expect(html).toContain('Corrected on')
  })

  it('excludes corrected note when isCorrected is false', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).not.toContain('Corrected on')
  })

  it('includes print CSS with @page rule', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).toContain('@page')
    expect(html).toContain('A4')
    expect(html).toContain('@media print')
  })

  it('includes published date in YYYY-MM-DD format', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).toContain('2026-11-02')
  })

  it('includes institution name, exam name, student name, and admission no', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).toContain('Test School')
    expect(html).toContain('Mid-Term Exam')
    expect(html).toContain('Alice Johnson')
    expect(html).toContain('ADM001')
  })

  it('contains no <script> tags', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).not.toMatch(/<script[\s>]/i)
  })

  it('contains no external URLs', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: null,
    })

    expect(html).not.toMatch(/https?:\/\//)
  })

  it('escapes a grading-scale label containing HTML in the per-subject row and the total row', () => {
    const resultWithXssGrade = {
      ...mockResult,
      grade: '<b>"A"</b>',
      subjects: [{ ...mockResult.subjects[0], grade: '<b>"A"</b>' }],
    }
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: resultWithXssGrade,
      remark: null,
    })

    expect(html).not.toContain('<b>"A"</b>')
    expect(html).toContain('&lt;b&gt;&quot;A&quot;&lt;/b&gt;')
  })

  it('escapes remark text', () => {
    const html = renderReportCardHtml({
      institutionName: 'Test School',
      result: mockResult,
      remark: '<img src=x onerror="alert(1)">',
    })

    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })
})
