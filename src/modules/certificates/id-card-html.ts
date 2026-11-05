// X02-T6 — ID card HTML renderer. Pure: formatPhoneIN, renderIdCardsHtml.
// Imports: escapeHtml from exams (M11), formatDateIN from certificate-html (T5).
import { escapeHtml } from '../exams/report-card-html.ts'
import { formatDateIN } from './certificate-html.ts'

export interface IdCard {
  name: string
  admissionNo: string
  dob: string
  guardianPhone: string | null
  photoDataUri: string | null
}

/**
 * Formats 10-digit phone as +91 XXXXX XXXXX (Indian format).
 */
export function formatPhoneIN(phone: string): string {
  // Strip anything but digits first (storage may include a +91 prefix or spaces), then take the last 10.
  const digits = phone.replace(/\D/g, '').slice(-10)
  const part1 = digits.slice(0, 5)
  const part2 = digits.slice(5)
  return `+91 ${part1} ${part2}`
}

/**
 * Validates photo data URI: must match ^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$
 */
function isValidPhotoDataUri(uri: string | null): boolean {
  if (!uri) return false
  const regex = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/
  return regex.test(uri)
}

/**
 * Renders initials placeholder when photo is invalid or missing.
 */
function renderInitialsPlaceholder(name: string): string {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
  return initials || '?'
}

/**
 * Renders ID cards as HTML document.
 * CR80 size (85.6 × 54 mm), 2 per row on A4, break-inside: avoid, no scripts.
 */
export function renderIdCardsHtml(input: {
  schoolName: string
  board: string
  academicYear: string
  classLabel: string
  cards: IdCard[]
  totalStudents: number
  photosSkipped: number
}): string {
  const { schoolName, academicYear, classLabel, cards, totalStudents, photosSkipped } = input

  // Monogram: first letters of school name words, up to 3.
  const monogram = schoolName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 3)

  // Build card HTML.
  const cardsHtml = cards
    .map((card) => {
      const dob = formatDateIN(card.dob)
      const phone = card.guardianPhone ? formatPhoneIN(card.guardianPhone) : 'N/A'
      const photoValid = isValidPhotoDataUri(card.photoDataUri)
      const photoOrInitials = photoValid
        ? `<img src="${card.photoDataUri}" alt="photo" class="card-photo">`
        : `<div class="card-initials">${renderInitialsPlaceholder(card.name)}</div>`

      return `
      <div class="id-card">
        <div class="card-header">
          <div class="card-monogram">${monogram}</div>
          <div class="card-school-name">${escapeHtml(schoolName)}</div>
          <div class="card-session">${escapeHtml(academicYear)}</div>
        </div>
        <div class="card-photo-container">
          ${photoOrInitials}
        </div>
        <div class="card-body">
          <div class="card-name">${escapeHtml(card.name)}</div>
          <div class="card-field">
            <span class="card-label">Adm. No:</span>
            <span class="card-value">${escapeHtml(card.admissionNo)}</span>
          </div>
          <div class="card-field">
            <span class="card-label">Class:</span>
            <span class="card-value">${escapeHtml(classLabel)}</span>
          </div>
          <div class="card-field">
            <span class="card-label">DOB:</span>
            <span class="card-value">${dob}</span>
          </div>
          <div class="card-field">
            <span class="card-label">Phone:</span>
            <span class="card-value">${escapeHtml(phone)}</span>
          </div>
        </div>
        <div class="card-footer">If found, please return to ${escapeHtml(schoolName)}</div>
      </div>
      `
    })
    .join('')

  // Footer notes.
  const footerNotes = []
  if (cards.length < totalStudents) {
    footerNotes.push(`showing ${cards.length} of ${totalStudents}`)
  }
  if (photosSkipped > 0) {
    footerNotes.push(`${photosSkipped} photos over 50 KB not shown — upload a 20–50 KB JPEG`)
  }
  const footerHtml = footerNotes.length > 0 ? `<div class="footer-notes">${footerNotes.join(' · ')}</div>` : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ID Cards</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      height: 100%;
    }

    body {
      font-family: Arial, sans-serif;
      font-size: 11px;
      color: #333;
      background-color: #fff;
      padding: 10mm;
    }

    .cards-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10mm;
      max-width: 210mm;
      margin: 0 auto;
    }

    .id-card {
      width: 85.6mm;
      height: 54mm;
      border: 1px solid #333;
      padding: 3mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      break-inside: avoid;
      page-break-inside: avoid;
      background-color: #fafafa;
      position: relative;
    }

    .card-header {
      text-align: center;
      border-bottom: 1px solid #ddd;
      padding-bottom: 2mm;
      margin-bottom: 2mm;
      font-size: 10px;
    }

    .card-monogram {
      width: 12mm;
      height: 12mm;
      border: 1px solid #333;
      border-radius: 50%;
      line-height: 12mm;
      text-align: center;
      font-weight: bold;
      font-size: 8px;
      margin: 0 auto 2mm;
    }

    .card-school-name {
      font-weight: bold;
      font-size: 9px;
      margin-bottom: 1mm;
    }

    .card-session {
      font-size: 8px;
      color: #666;
    }

    .card-photo-container {
      width: 100%;
      height: 18mm;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 2mm;
      background-color: #eee;
      border: 1px solid #ccc;
    }

    .card-photo {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .card-initials {
      width: 14mm;
      height: 14mm;
      border: 1px solid #999;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 10px;
      background-color: #ddd;
    }

    .card-body {
      flex: 1;
      font-size: 9px;
      line-height: 1.3;
    }

    .card-name {
      font-weight: bold;
      font-size: 10px;
      margin-bottom: 1mm;
      word-break: break-word;
    }

    .card-field {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5mm;
    }

    .card-label {
      font-weight: bold;
      margin-right: 2mm;
      min-width: 30mm;
    }

    .card-value {
      text-align: right;
      flex: 1;
      word-break: break-word;
    }

    .card-footer {
      border-top: 1px solid #ddd;
      padding-top: 1mm;
      font-size: 8px;
      text-align: center;
      color: #666;
      line-height: 1.2;
    }

    .footer-notes {
      margin-top: 10mm;
      text-align: center;
      font-size: 10px;
      color: #666;
      page-break-inside: avoid;
    }

    @page {
      size: A4;
      margin: 10mm;
    }

    @media print {
      body {
        padding: 0;
        margin: 0;
      }
      .cards-container {
        gap: 5mm;
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="cards-container">
    ${cardsHtml}
  </div>
  ${footerHtml}
</body>
</html>
  `
}
