import { describe, it, expect } from 'vitest'
import {
  formatDateIN,
  dateInWords,
  relationPhrase,
  formatInr,
  renderCertificateHtml,
} from '@/modules/certificates/certificate-html'
import type { CertificateSnapshot } from '@/modules/certificates/schemas'

describe('formatDateIN', () => {
  it('formats ISO date to DD-MM-YYYY', () => {
    expect(formatDateIN('2024-11-05')).toBe('05-11-2024')
    expect(formatDateIN('2012-08-15')).toBe('15-08-2012')
    expect(formatDateIN('2000-01-01')).toBe('01-01-2000')
  })
})

describe('dateInWords', () => {
  it('converts ISO date to English words', () => {
    expect(dateInWords('2012-08-15')).toBe('Fifteenth August Two Thousand Twelve')
    expect(dateInWords('2024-11-05')).toBe('Fifth November Two Thousand Twenty Four')
    expect(dateInWords('2000-01-01')).toBe('First January Two Thousand')
    expect(dateInWords('1999-12-31')).toBe('Thirty First December One Thousand Nine Hundred Ninety Nine')
  })
})

describe('relationPhrase', () => {
  it('returns "son of" for male with father or unspecified relation', () => {
    expect(relationPhrase('M', 'father')).toBe('son of')
    expect(relationPhrase('M', 'mother')).toBe('son of')
    expect(relationPhrase('M', null)).toBe('son of')
  })

  it('returns "daughter of" for female with father or unspecified relation', () => {
    expect(relationPhrase('F', 'father')).toBe('daughter of')
    expect(relationPhrase('F', 'mother')).toBe('daughter of')
    expect(relationPhrase('F', null)).toBe('daughter of')
  })

  it('returns "ward of" for legal_guardian, grandparent, or other relations', () => {
    expect(relationPhrase('M', 'legal_guardian')).toBe('ward of')
    expect(relationPhrase('F', 'legal_guardian')).toBe('ward of')
    expect(relationPhrase('M', 'grandparent')).toBe('ward of')
    expect(relationPhrase('F', 'grandparent')).toBe('ward of')
    expect(relationPhrase('M', 'other')).toBe('ward of')
    expect(relationPhrase('F', 'other')).toBe('ward of')
  })

  it('defaults to "ward of" for unrecognized gender', () => {
    expect(relationPhrase('X', 'father')).toBe('ward of')
  })
})

describe('formatInr', () => {
  it('formats numbers as Indian currency', () => {
    expect(formatInr(1500)).toBe('₹1,500.00')
    expect(formatInr(123456)).toBe('₹1,23,456.00')
    expect(formatInr(1234567)).toBe('₹12,34,567.00')
    expect(formatInr(100)).toBe('₹100.00')
  })

  it('handles zero', () => {
    expect(formatInr(0)).toBe('₹0.00')
  })

  it('handles floats', () => {
    expect(formatInr(1500.5)).toBe('₹1,500.50')
    expect(formatInr(123456.99)).toBe('₹1,23,456.99')
  })
})

describe('renderCertificateHtml', () => {
  const bonafideSnapshot: CertificateSnapshot = {
    kind: 'bonafide',
    serial_no: 'BON/2024/00001',
    issued_on: '2024-11-05',
    issued_by_name: 'Dr. Sharma',
    school: {
      name: 'ABC School',
      board: 'CBSE',
      address: '123 Main St, Mumbai, Maharashtra, 400001',
    },
    student: {
      name: 'Raj Kumar',
      admission_no: 'ADM001',
      dob: '2012-08-15',
      gender: 'M',
      status: 'active',
    },
    guardian: {
      name: 'Mr. Suresh Kumar',
      relationship: 'father',
    },
    enrolment: {
      grade: 'X',
      section: 'A',
      academic_year: '2024-2025',
      roll_no: 15,
      status: 'active',
    },
    admitted_on: '2020-06-01',
    purpose: 'Passport application',
    conduct: null,
    tc: null,
  }

  const characterSnapshot: CertificateSnapshot = {
    ...bonafideSnapshot,
    kind: 'character',
    serial_no: 'CHR/2024/00001',
    student: {
      ...bonafideSnapshot.student,
      status: 'withdrawn',
    },
    purpose: null,
    conduct: 'Very good',
  }

  const tcSnapshot: CertificateSnapshot = {
    kind: 'transfer',
    serial_no: 'TC/2024/00001',
    issued_on: '2024-11-05',
    issued_by_name: 'Dr. Sharma',
    school: {
      name: 'ABC School',
      board: 'CBSE',
      address: '123 Main St, Mumbai, Maharashtra, 400001',
    },
    student: {
      name: 'Aarav Patel',
      admission_no: 'ADM002',
      dob: '2010-01-20',
      gender: 'M',
      status: 'withdrawn',
    },
    guardian: {
      name: 'Mrs. Priya Patel',
      relationship: 'mother',
    },
    enrolment: {
      grade: 'XII',
      section: 'B',
      academic_year: '2023-2024',
      roll_no: 22,
      status: 'completed',
    },
    admitted_on: '2018-06-15',
    purpose: null,
    conduct: null,
    tc: {
      tc_no: 'TC/2024/00001',
      student_name: 'Aarav Patel',
      admission_no: 'ADM002',
      dob: '2010-01-20',
      gender: 'M',
      primary_guardian_name: 'Mrs. Priya Patel',
      grade: 'XII',
      section: 'B',
      academic_year: '2023-2024',
      admitted_on: '2018-06-15',
      left_on: '2024-05-30',
      kind: 'transferred_out',
      reason: 'Relocated to abroad',
      destination_school: 'International School, USA',
      conduct: 'Good',
      dues_outstanding: 0,
    },
  }

  it('escapes HTML in student name', () => {
    const snapshot: CertificateSnapshot = {
      ...bonafideSnapshot,
      student: {
        ...bonafideSnapshot.student,
        name: '<script>alert("xss")</script>',
      },
    }
    const html = renderCertificateHtml(snapshot)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('escapes HTML in enrolment grade/section (bonafide class label)', () => {
    const snapshot: CertificateSnapshot = {
      ...bonafideSnapshot,
      enrolment: {
        ...bonafideSnapshot.enrolment!,
        grade: '<img src=x onerror=alert(1)>',
        section: '"><script>alert(2)</script>',
      },
    }
    const html = renderCertificateHtml(snapshot)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(2)</script>')
    expect(html).toContain('&lt;img')
  })

  it('renders bonafide with purpose and DOB in words', () => {
    const html = renderCertificateHtml(bonafideSnapshot)
    expect(html).toContain('bonafide student')
    expect(html).toContain('Passport application')
    expect(html).toContain('Fifteenth August Two Thousand Twelve')
    expect(html).toContain('Class X-A')
    expect(html).toContain('2024-2025')
  })

  it('renders character certificate for active student with "is"', () => {
    const activeCharacter = {
      ...characterSnapshot,
      student: { ...characterSnapshot.student, status: 'active' },
    }
    const html = renderCertificateHtml(activeCharacter)
    expect(html).toContain('is a student')
    expect(html).toContain('Very good')
  })

  it('renders character certificate for withdrawn student with "was"', () => {
    const html = renderCertificateHtml(characterSnapshot)
    expect(html).toContain('was a student')
    expect(html).toContain('Very good')
  })

  it('escapes HTML in TC grade/section (class last studied)', () => {
    const html = renderCertificateHtml({
      ...tcSnapshot,
      tc: {
        ...tcSnapshot.tc!,
        grade: '<img src=x onerror=alert(1)>',
        section: '"><script>alert(2)</script>',
      },
    })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(2)</script>')
    expect(html).toContain('&lt;img')
  })

  it('renders TC with a null grade as empty (not "null" text, no crash)', () => {
    const html = renderCertificateHtml({
      ...tcSnapshot,
      tc: {
        ...tcSnapshot.tc!,
        grade: null,
        section: null,
      },
    })
    expect(html).not.toContain('null')
  })

  it('renders TC with dues cleared as "Yes"', () => {
    const html = renderCertificateHtml(tcSnapshot)
    expect(html).toContain('Yes')
    expect(html).toContain('Dues Cleared')
  })

  it('renders TC with outstanding dues as formatted currency', () => {
    const tcWithDues: CertificateSnapshot = {
      ...tcSnapshot,
      tc: {
        ...tcSnapshot.tc!,
        dues_outstanding: 1500,
      },
    }
    const html = renderCertificateHtml(tcWithDues)
    expect(html).toContain('No — ₹1,500.00 outstanding')
  })

  it('has @page CSS rule', () => {
    const html = renderCertificateHtml(bonafideSnapshot)
    expect(html).toContain('@page')
    expect(html).toContain('size: A4')
    expect(html).toContain('margin: 15mm')
  })

  it('has no script tags', () => {
    const html = renderCertificateHtml(bonafideSnapshot)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
  })

  it('has no external URLs', () => {
    const html = renderCertificateHtml(bonafideSnapshot)
    expect(html).not.toMatch(/http:\/\//i)
    expect(html).not.toMatch(/https:\/\//i)
  })

  it('includes school header with monogram', () => {
    const html = renderCertificateHtml(bonafideSnapshot)
    expect(html).toContain('ABC School')
    expect(html).toContain('CBSE')
    expect(html).toContain('123 Main St, Mumbai, Maharashtra, 400001')
  })

  it('includes serial number and issue date', () => {
    const html = renderCertificateHtml(bonafideSnapshot)
    expect(html).toContain('BON/2024/00001')
    expect(html).toContain('05-11-2024')
  })

  it('includes signature lines for principal and class teacher', () => {
    const html = renderCertificateHtml(bonafideSnapshot)
    expect(html).toContain('Class Teacher')
    expect(html).toContain('Principal')
  })

  it('renders TC table with all required fields', () => {
    const html = renderCertificateHtml(tcSnapshot)
    expect(html).toContain('Aarav Patel')
    expect(html).toContain('Twentieth January Two Thousand Ten') // DOB in words
    expect(html).toContain('20-01-2010') // DOB in DD-MM-YYYY
    expect(html).toContain('ADM002')
    expect(html).toContain('15-06-2018') // admitted on
    expect(html).toContain('XII-B')
    expect(html).toContain('30-05-2024') // left on
    expect(html).toContain('Relocated to abroad')
    expect(html).toContain('International School, USA')
  })

  it('uses correct relation phrase in TC', () => {
    const html = renderCertificateHtml(tcSnapshot)
    expect(html).toContain('son of')
  })

  it('renders HTML5 doctype and meta tags', () => {
    const html = renderCertificateHtml(bonafideSnapshot)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('lang="en"')
    expect(html).toContain('charset="UTF-8"')
  })
})
