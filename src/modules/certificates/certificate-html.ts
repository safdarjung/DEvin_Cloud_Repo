// X02-T5 — Pure HTML renderers for certificates (bonafide, character, transfer/TC).
// Imports: type only + escapeHtml from exams (M11).
import type { CertificateSnapshot } from "./schemas.ts";
import { escapeHtml } from "../exams/report-card-html.ts";

/**
 * Formats ISO date string (YYYY-MM-DD) to Indian format (DD-MM-YYYY).
 */
export function formatDateIN(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}-${month}-${year}`;
}

const DAYS = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
  "Eleventh",
  "Twelfth",
  "Thirteenth",
  "Fourteenth",
  "Fifteenth",
  "Sixteenth",
  "Seventeenth",
  "Eighteenth",
  "Nineteenth",
  "Twentieth",
  "Twenty First",
  "Twenty Second",
  "Twenty Third",
  "Twenty Fourth",
  "Twenty Fifth",
  "Twenty Sixth",
  "Twenty Seventh",
  "Twenty Eighth",
  "Twenty Ninth",
  "Thirtieth",
  "Thirty First",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
];
const TENS = [
  "",
  "Ten",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];
const TEENS = [
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

function twoDigitInWords(num: number): string {
  if (num === 0) return "";
  if (num < 10) return ONES[num];
  if (num < 20) return TEENS[num - 10];
  const tens = Math.floor(num / 10);
  const ones = num % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]} ${ONES[ones]}`;
}

/**
 * Converts ISO date (YYYY-MM-DD) to English words.
 * Example: 2012-08-15 → "Fifteenth August Two Thousand Twelve"
 */
export function dateInWords(iso: string): string {
  const [yearStr, monthStr, dayStr] = iso.split("-");
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);

  const dayWord = DAYS[day - 1];
  const monthWord = MONTHS[month - 1];

  // Convert year to words.
  if (year >= 1900 && year <= 2099) {
    const century = Math.floor(year / 100);
    const remainder = year % 100;

    let yearWord: string;
    if (century === 19) {
      if (remainder === 0) {
        yearWord = "One Thousand Nine Hundred";
      } else if (remainder < 10) {
        yearWord = `One Thousand Nine Hundred ${ONES[remainder]}`;
      } else if (remainder < 20) {
        yearWord = `One Thousand Nine Hundred ${TEENS[remainder - 10]}`;
      } else {
        const t = Math.floor(remainder / 10);
        const o = remainder % 10;
        const tword = TENS[t];
        yearWord = o === 0 ? `One Thousand Nine Hundred ${tword}` : `One Thousand Nine Hundred ${tword} ${ONES[o]}`;
      }
    } else {
      // century === 20
      yearWord = "Two Thousand";
      if (remainder > 0) {
        yearWord += ` ${twoDigitInWords(remainder)}`;
      }
    }

    return `${dayWord} ${monthWord} ${yearWord}`;
  }

  return `${dayWord} ${monthWord} ${year}`;
}

// The DB stores "male"/"female"/"other"; snapshots and tests may carry "M"/"F".
const isMale = (g: string) => g === "M" || g === "male";
const isFemale = (g: string) => g === "F" || g === "female";

/** He/She from the stored gender; falls back to "He/She" when unknown. */
function pronoun(gender: string): string {
  return isMale(gender) ? "He" : isFemale(gender) ? "She" : "He/She";
}

/**
 * Determines relation phrase based on gender and relationship.
 * male/female + "father"/"mother"/null → "son of" / "daughter of"
 * legal_guardian/grandparent/other → "ward of"
 */
export function relationPhrase(
  gender: string,
  relationship: string | null
): "son of" | "daughter of" | "ward of" {
  if (relationship === "legal_guardian" || relationship === "grandparent" || relationship === "other") {
    return "ward of";
  }

  if (isMale(gender)) return "son of";
  if (isFemale(gender)) return "daughter of";
  return "ward of";
}

/**
 * Formats number as Indian currency (e.g., 1,23,456.00).
 */
export function formatInr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(n);
}

/**
 * Renders bonafide certificate HTML.
 */
function renderBonafideHtml(snapshot: CertificateSnapshot): string {
  const { student, guardian, enrolment, school, issued_by_name, serial_no, issued_on, purpose } = snapshot;

  const issueDate = formatDateIN(issued_on);
  const dobDate = formatDateIN(student.dob);
  const dobWords = dateInWords(student.dob);
  const relPhrase = relationPhrase(student.gender, guardian?.relationship ?? null);

  const guardianLine = guardian
    ? `${relPhrase} ${escapeHtml(guardian.name)}`
    : `${relPhrase} [Guardian Name]`;

  const classLabel = enrolment ? `${escapeHtml(enrolment.grade)}-${escapeHtml(enrolment.section)}` : "—";
  const academicYear = enrolment?.academic_year ?? "—";

  return `
<div class="certificate bonafide">
  <h2>Bonafide Certificate</h2>
  <p>This is to certify that <strong>${escapeHtml(student.name)}</strong>, ${guardianLine},
  is a bonafide student of ${escapeHtml(school.name)}.
  ${pronoun(student.gender)} is studying in Class ${classLabel} for the academic session ${academicYear}.</p>

  <p><strong>Date of Birth:</strong> ${dobDate} (${dobWords})</p>
  <p><strong>Purpose:</strong> ${escapeHtml(purpose ?? "")}</p>

  <p><strong>Serial Number:</strong> ${escapeHtml(serial_no)}</p>
  <p><strong>Date of Issue:</strong> ${issueDate}</p>
  <p><strong>Issued by:</strong> ${escapeHtml(issued_by_name)}</p>
</div>
  `;
}

/**
 * Renders character certificate HTML.
 */
function renderCharacterHtml(snapshot: CertificateSnapshot): string {
  const { student, guardian, school, issued_by_name, serial_no, issued_on, conduct, purpose } = snapshot;

  const issueDate = formatDateIN(issued_on);
  const relPhrase = relationPhrase(student.gender, guardian?.relationship ?? null);
  const verb = student.status === "active" ? "is" : "was";

  const guardianLine = guardian
    ? `${relPhrase} ${escapeHtml(guardian.name)}`
    : `${relPhrase} [Guardian Name]`;

  return `
<div class="certificate character">
  <h2>Character Certificate</h2>
  <p>This is to certify that <strong>${escapeHtml(student.name)}</strong>, ${guardianLine},
  ${verb} a student of ${escapeHtml(school.name)}.</p>

  <p>The conduct and character of the above student have been <strong>${escapeHtml(conduct ?? "Good")}</strong>.</p>
${purpose ? `
  <p><strong>Purpose:</strong> ${escapeHtml(purpose)}</p>
` : ""}
  <p><strong>Serial Number:</strong> ${escapeHtml(serial_no)}</p>
  <p><strong>Date of Issue:</strong> ${issueDate}</p>
  <p><strong>Issued by:</strong> ${escapeHtml(issued_by_name)}</p>
</div>
  `;
}

/**
 * Renders transfer certificate (TC) HTML.
 */
function renderTransferCertificateHtml(snapshot: CertificateSnapshot): string {
  const tc = snapshot.tc;
  if (!tc) {
    return "<div class='certificate transfer'><p>Transfer Certificate data missing.</p></div>";
  }

  const issued_by_name = snapshot.issued_by_name;
  const issueDate = formatDateIN(snapshot.issued_on);
  const dobDate = formatDateIN(tc.dob);
  const dobWords = dateInWords(tc.dob);
  const admittedDate = formatDateIN(tc.admitted_on ?? "");
  const leftDate = formatDateIN(tc.left_on);

  const relPhrase = relationPhrase(tc.gender, null);
  const duesStatus =
    tc.dues_outstanding > 0 ? `No — ${formatInr(tc.dues_outstanding)} outstanding` : "Yes";

  const destinationSchool = tc.kind === "transferred_out" ? tc.destination_school : null;

  return `
<div class="certificate transfer">
  <h2>Transfer Certificate</h2>

  <table class="tc-table">
    <tbody>
      <tr>
        <td class="label">Name of Student:</td>
        <td>${escapeHtml(tc.student_name)}</td>
      </tr>
      <tr>
        <td class="label">Admission No.:</td>
        <td>${escapeHtml(tc.admission_no)}</td>
      </tr>
      <tr>
        <td class="label">Date of Birth:</td>
        <td>${dobDate} (${dobWords})</td>
      </tr>
      <tr>
        <td class="label">Gender:</td>
        <td>${tc.gender === "M" ? "Male" : "Female"}</td>
      </tr>
      <tr>
        <td class="label">Father/Guardian:</td>
        <td>${relPhrase} ${escapeHtml(tc.primary_guardian_name ?? "[Guardian Name]")}</td>
      </tr>
      <tr>
        <td class="label">Date of Admission:</td>
        <td>${admittedDate}</td>
      </tr>
      <tr>
        <td class="label">Class Last Studied:</td>
        <td>${escapeHtml(tc.grade ?? "")}${tc.section ? `-${escapeHtml(tc.section)}` : ""}</td>
      </tr>
      <tr>
        <td class="label">Date of Leaving:</td>
        <td>${leftDate}</td>
      </tr>
      <tr>
        <td class="label">Reason for Leaving:</td>
        <td>${escapeHtml(tc.reason ?? "")}</td>
      </tr>
      ${destinationSchool ? `
      <tr>
        <td class="label">School Transferred To:</td>
        <td>${escapeHtml(destinationSchool)}</td>
      </tr>
      ` : ""}
      <tr>
        <td class="label">Conduct:</td>
        <td>${escapeHtml(tc.conduct ?? "Good")}</td>
      </tr>
      <tr>
        <td class="label">Dues Cleared:</td>
        <td>${duesStatus}</td>
      </tr>
    </tbody>
  </table>

  <p><strong>Serial Number:</strong> ${escapeHtml(tc.tc_no)}</p>
  <p><strong>Date of Issue:</strong> ${issueDate}</p>
  <p><strong>Issued by:</strong> ${escapeHtml(issued_by_name)}</p>
</div>
  `;
}

/**
 * Renders complete certificate HTML document.
 * No external assets, no scripts, inline styles only.
 */
export function renderCertificateHtml(snapshot: CertificateSnapshot): string {
  const { kind, school, serial_no, issued_on } = snapshot;

  const issueDate = formatDateIN(issued_on);

  // Choose certificate type.
  let certificateContent = "";
  if (kind === "bonafide") {
    certificateContent = renderBonafideHtml(snapshot);
  } else if (kind === "character") {
    certificateContent = renderCharacterHtml(snapshot);
  } else if (kind === "transfer") {
    certificateContent = renderTransferCertificateHtml(snapshot);
  }

  // Build school address if available.

  // Monogram: first letters of school name words.
  const monogram = school.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(serial_no)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 12px;
      color: #333;
      line-height: 1.6;
      background-color: #fff;
      padding: 0;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 2px solid #000;
      padding-bottom: 20px;
    }

    .monogram {
      display: inline-block;
      width: 60px;
      height: 60px;
      border: 2px solid #000;
      border-radius: 50%;
      line-height: 60px;
      text-align: center;
      font-weight: bold;
      font-size: 24px;
      margin-bottom: 10px;
    }

    .school-info {
      margin-top: 10px;
    }

    .school-name {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 4px;
    }

    .school-board {
      font-size: 13px;
      margin-bottom: 4px;
    }

    .school-address {
      font-size: 11px;
      color: #666;
      max-width: 600px;
      margin: 0 auto;
    }

    .certificate {
      margin-bottom: 40px;
    }

    .certificate h2 {
      text-align: center;
      font-size: 20px;
      font-weight: bold;
      text-decoration: underline;
      margin-bottom: 20px;
    }

    .certificate p {
      margin-bottom: 12px;
      text-align: justify;
    }

    .certificate.transfer p {
      margin-bottom: 8px;
      text-align: left;
    }

    .tc-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }

    .tc-table tr {
      border-bottom: 1px solid #ccc;
    }

    .tc-table td {
      padding: 8px;
      font-size: 12px;
    }

    .tc-table .label {
      font-weight: bold;
      width: 40%;
      text-align: left;
    }

    .signature-section {
      margin-top: 40px;
      display: flex;
      justify-content: space-between;
    }

    .signature-line {
      flex: 1;
      text-align: center;
      border-top: 1px solid #000;
      padding-top: 30px;
      font-size: 12px;
    }

    .signature-line:nth-child(2) {
      margin: 0 20px;
    }

    @page {
      size: A4;
      margin: 15mm;
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
      <div class="monogram">${monogram}</div>
      <div class="school-info">
        <div class="school-name">${escapeHtml(school.name)}</div>
        ${school.board ? `<div class="school-board">${escapeHtml(school.board)}</div>` : ""}
        ${school.address ? `<div class="school-address">${escapeHtml(school.address)}</div>` : ""}
      </div>
    </div>

    ${certificateContent}

    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ccc;">
      <p style="font-size: 11px; text-align: center;"><strong>Serial No.:</strong> ${escapeHtml(serial_no)}</p>
      <p style="font-size: 11px; text-align: center;"><strong>Date of Issue:</strong> ${issueDate}</p>
    </div>

    <div class="signature-section">
      <div class="signature-line">
        <div style="min-height: 40px;"></div>
        Class Teacher
      </div>
      <div class="signature-line">
        <div style="min-height: 40px;"></div>
        Principal<br><small>(Signature & Seal)</small>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}
