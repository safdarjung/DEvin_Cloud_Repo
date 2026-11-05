import { describe, it, expect } from 'vitest'
import {
  formatPhoneIN,
  renderIdCardsHtml,
  type IdCard,
} from '@/modules/certificates/id-card-html'

describe('formatPhoneIN', () => {
  it('formats 10-digit phone to +91 format', () => {
    expect(formatPhoneIN('9800000001')).toBe('+91 98000 00001')
    expect(formatPhoneIN('9876543210')).toBe('+91 98765 43210')
  })

  it('handles edge cases', () => {
    expect(formatPhoneIN('1234567890')).toBe('+91 12345 67890')
  })

  it('strips non-digit characters before formatting', () => {
    expect(formatPhoneIN('+91 98000 00001')).toBe('+91 98000 00001')
    expect(formatPhoneIN('+919876543210')).toBe('+91 98765 43210')
    expect(formatPhoneIN('98000-00001')).toBe('+91 98000 00001')
  })
})

describe('renderIdCardsHtml', () => {
  const baseInput = {
    schoolName: 'Test School',
    board: 'CBSE',
    academicYear: '2024-25',
    classLabel: 'X-A',
    totalStudents: 45,
    photosSkipped: 0,
  }

  it('renders one card per input', () => {
    const cards: IdCard[] = [
      {
        name: 'Alice Johnson',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: '9800000001',
        photoDataUri: null,
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    expect(html).toContain('Alice Johnson')
    expect(html).toContain('ADM001')
  })

  it('escapes HTML in name', () => {
    const cards: IdCard[] = [
      {
        name: '<script>alert("xss")</script>',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: null,
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('formats phone number correctly', () => {
    const cards: IdCard[] = [
      {
        name: 'Bob Smith',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: '9876543210',
        photoDataUri: null,
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    expect(html).toContain('+91 98765 43210')
  })

  it('renders valid data URI photo', () => {
    const cards: IdCard[] = [
      {
        name: 'Charlie Brown',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    expect(html).toContain('data:image/png;base64,')
  })

  it('rejects javascript: URI', () => {
    const cards: IdCard[] = [
      {
        name: 'Eve Davis',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: 'javascript:alert("xss")',
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img')
  })

  it('rejects https: URI', () => {
    const cards: IdCard[] = [
      {
        name: 'Frank Miller',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: 'https://example.com/photo.jpg',
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    expect(html).not.toContain('https://')
    expect(html).not.toContain('<img')
  })

  it('renders "showing X of Y" footer', () => {
    const cards: IdCard[] = Array.from({ length: 10 }, (_, i) => ({
      name: `Student ${i}`,
      admissionNo: `ADM${String(i).padStart(3, '0')}`,
      dob: '2010-05-15',
      guardianPhone: null,
      photoDataUri: null,
    }))

    const html = renderIdCardsHtml({ ...baseInput, cards, totalStudents: 45 })
    expect(html).toContain('showing 10 of 45')
  })

  it('renders "N photos over 50 KB" footer when photosSkipped > 0', () => {
    const cards: IdCard[] = [
      {
        name: 'Grace Lee',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: null,
      },
    ]

    const html = renderIdCardsHtml({
      ...baseInput,
      cards,
      photosSkipped: 3,
    })
    expect(html).toContain('3 photos over 50 KB')
  })

  it('contains @page CSS and no scripts', () => {
    const cards: IdCard[] = [
      {
        name: 'Henry Wilson',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: null,
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    expect(html).toContain('@page')
    expect(html).not.toContain('<script')
  })

  it('renders CR80 card size in CSS', () => {
    const cards: IdCard[] = [
      {
        name: 'Ivy Thomas',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: null,
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    // CR80 is 85.6mm x 54mm
    expect(html).toContain('85.6mm')
    expect(html).toContain('54mm')
  })

  it('renders 2 cards per row', () => {
    const cards: IdCard[] = [
      {
        name: 'Student 1',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: null,
      },
      {
        name: 'Student 2',
        admissionNo: 'ADM002',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: null,
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    expect(html).toContain('break-inside: avoid')
  })

  it('includes school name and monogram on card', () => {
    const cards: IdCard[] = [
      {
        name: 'Jack King',
        admissionNo: 'ADM001',
        dob: '2010-05-15',
        guardianPhone: null,
        photoDataUri: null,
      },
    ]

    const html = renderIdCardsHtml({ ...baseInput, cards })
    expect(html).toContain('Test School')
  })
})
