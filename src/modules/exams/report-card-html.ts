import type { ResultDetail } from './queries'

/**
 * Escapes HTML special characters to prevent XSS.
 */
export function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
  }
  return s.replace(/[&<>"']/g, (char) => map[char] || char)
}

interface RenderInput {
  institutionName: string
  result: ResultDetail
  remark: string | null
}

/**
 * Renders a complete HTML5 report card document.
 * No external assets, no scripts, inline styles only.
 */
export function renderReportCardHtml({ institutionName, result, remark }: RenderInput): string {
  const publishedDate = new Date(result.publishedAt).toISOString().split('T')[0]
  const correctedDate = result.isCorrected ? new Date(result.publishedAt).toLocaleDateString() : null

  const subjectsHtml = result.subjects
    .map((subject) => {
      const marksDisplay = subject.isAbsent ? 'AB' : subject.marksObtained?.toString() ?? 'AB'
      return `
      <tr>
        <td style="border-bottom: 1px solid #e0e0e0; padding: 8px; text-align: left;">${escapeHtml(subject.subjectName)}</td>
        <td style="border-bottom: 1px solid #e0e0e0; padding: 8px; text-align: right;">${marksDisplay}</td>
        <td style="border-bottom: 1px solid #e0e0e0; padding: 8px; text-align: right;">${subject.maxMarks}</td>
        <td style="border-bottom: 1px solid #e0e0e0; padding: 8px; text-align: right;">${escapeHtml(subject.grade ?? '—')}</td>
        <td style="border-bottom: 1px solid #e0e0e0; padding: 8px; text-align: center;">${subject.passed ? 'Pass' : 'Fail'}</td>
      </tr>
    `
    })
    .join('')

  const remarkHtml =
    remark && remark.trim()
      ? `
    <div style="margin-top: 20px; padding: 12px; border-left: 3px solid #333; background-color: #f9f9f9;">
      <p style="margin: 0 0 8px 0; font-weight: bold; font-size: 12px;">Teacher's Remark:</p>
      <p style="margin: 0; font-style: italic; font-size: 12px;">${escapeHtml(remark)}</p>
    </div>
  `
      : ''

  const correctedNoteHtml = result.isCorrected
    ? `<p style="margin: 0 0 12px 0; font-size: 12px; color: #666;">Corrected on ${escapeHtml(correctedDate || '')}</p>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(result.studentName)} — ${escapeHtml(result.examName)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      color: #333;
      line-height: 1.4;
      background-color: #fff;
      padding: 0;
    }

    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }

    .header {
      border-bottom: 2px solid #000;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }

    .school-name {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 8px;
    }

    .title {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 4px;
    }

    .subtitle {
      font-size: 12px;
      color: #666;
      margin-bottom: 2px;
    }

    .student-info {
      margin-bottom: 20px;
      font-size: 12px;
    }

    .student-info-row {
      display: flex;
      margin-bottom: 4px;
    }

    .student-info-label {
      font-weight: bold;
      width: 120px;
    }

    .student-info-value {
      flex: 1;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }

    th {
      background-color: #f0f0f0;
      border: 1px solid #ccc;
      padding: 8px;
      text-align: left;
      font-weight: bold;
      font-size: 12px;
    }

    td {
      border: 1px solid #ccc;
      padding: 8px;
      font-size: 12px;
    }

    tfoot tr td {
      font-weight: bold;
      background-color: #f9f9f9;
    }

    .summary {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
      font-size: 12px;
    }

    .summary-item {
      padding: 10px;
      background-color: #f5f5f5;
      border-radius: 4px;
    }

    .summary-label {
      color: #666;
      font-size: 11px;
      margin-bottom: 4px;
    }

    .summary-value {
      font-weight: bold;
      font-size: 14px;
    }

    .footer {
      margin-top: 20px;
      padding-top: 12px;
      border-top: 1px solid #ccc;
      font-size: 11px;
      color: #999;
      text-align: right;
    }

    @page {
      size: A4;
      margin: 12mm;
    }

    @media print {
      body {
        background-color: #fff;
      }
      .container {
        padding: 0;
        max-width: 100%;
      }
      .header {
        border-bottom: 1px solid #000;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="school-name">${escapeHtml(institutionName)}</div>
      <div class="title">Report Card</div>
      <div class="subtitle">${escapeHtml(result.examName)} (${escapeHtml(result.examType)})</div>
    </div>

    <div class="student-info">
      <div class="student-info-row">
        <div class="student-info-label">Student Name:</div>
        <div class="student-info-value">${escapeHtml(result.studentName)}</div>
      </div>
      <div class="student-info-row">
        <div class="student-info-label">Admission No.:</div>
        <div class="student-info-value">${escapeHtml(result.admissionNo)}</div>
      </div>
    </div>

    ${correctedNoteHtml}

    <table>
      <thead>
        <tr>
          <th>Subject</th>
          <th style="text-align: right;">Marks</th>
          <th style="text-align: right;">Max</th>
          <th style="text-align: right;">Grade</th>
          <th style="text-align: center;">Result</th>
        </tr>
      </thead>
      <tbody>
        ${subjectsHtml}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td style="text-align: right;">${result.total}</td>
          <td style="text-align: right;">${result.maxTotal}</td>
          <td style="text-align: right;">${escapeHtml(result.grade)}</td>
          <td style="text-align: center;">—</td>
        </tr>
      </tfoot>
    </table>

    <div class="summary">
      <div class="summary-item">
        <div class="summary-label">Percentage</div>
        <div class="summary-value">${result.percentage.toFixed(1)}%</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Overall Grade</div>
        <div class="summary-value">${escapeHtml(result.grade)}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Attendance</div>
        <div class="summary-value">${result.attendancePercentage}%</div>
      </div>
    </div>

    ${remarkHtml}

    <div class="footer">
      <p>Published on ${publishedDate}</p>
    </div>
  </div>
</body>
</html>`
}
