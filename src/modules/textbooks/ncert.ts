// NCERT catalogue helpers, pure (no server-only import, relative imports
// only) so the seed script and the "Suggest NCERT books" action share them.
// Links only: NCERT books are free for non-commercial use and this product
// is commercial, so the app points at ncert.nic.in and never fetches,
// proxies or stores a PDF (0139 header).

export interface CatalogueBook {
  code: string;
  classLevel: number | null;
  subject: string;
  title: string;
  medium: string;
  chaptersCount: number;
  bookUrl: string;
  chapterPdfPattern: string;
  verified: boolean;
}

export interface ChapterLink {
  no: number;
  url: string;
  /** "pdf": the official chapter PDF; "page": the official book page (unverified rows). */
  kind: "pdf" | "page";
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
// Pre-primary names carry digits ("KG 1") that are not class numbers.
const PRE_PRIMARY = /\b(nursery|pre[\s-]?(k|kg|nursery|primary|school)|lkg|ukg|kg|kindergarten|playgroup|play\s?school)\b/i;

function classFromText(text: string): number | null {
  if (PRE_PRIMARY.test(text)) return null;
  const tokens = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (/^\d{1,2}$/.test(token)) {
      const n = Number(token);
      if (n >= 1 && n <= 12) return n;
    }
    const roman = ROMAN.indexOf(token.toUpperCase());
    if (roman >= 0 && token.length <= 4) return roman + 1;
  }
  return null;
}

/** Class 1-12 from a school's grade code, then its display name ("VI", "Grade VI", "Class 6"); null when neither names one (Nursery, LKG, "Senior"). */
export function classNumberFromGrade(grade: { code: string; displayName: string }): number | null {
  return classFromText(grade.code) ?? classFromText(grade.displayName);
}

// Canonical subject -> names schools and the NCERT selector use for it.
const SUBJECT_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  mathematics: ["mathematics", "maths", "math", "ganit"],
  english: ["english", "english language", "english literature"],
  hindi: ["hindi", "hindi language"],
  sanskrit: ["sanskrit"],
  urdu: ["urdu"],
  science: ["science", "general science"],
  "social science": ["social science", "social sciences", "social studies", "sst", "s st"],
  evs: ["evs", "environmental studies", "environmental science", "environment", "the world around us", "world around us"],
  physics: ["physics"],
  chemistry: ["chemistry"],
  biology: ["biology"],
  "computer science": ["computer science", "computers", "computer", "cs"],
  "informatics practices": ["informatics practices", "ip"],
  economics: ["economics"],
  accountancy: ["accountancy", "accounts", "accounting"],
  "business studies": ["business studies", "bst", "business"],
  history: ["history"],
  geography: ["geography"],
  "political science": ["political science", "pol science", "pol sci", "civics", "politics"],
  psychology: ["psychology"],
  sociology: ["sociology"],
  "home science": ["home science"],
  arts: ["arts", "art", "art education", "visual arts"],
  "physical education": [
    "physical education",
    "pe",
    "p e",
    "health and physical education",
    "physical education and well being",
    "sports",
  ],
};

const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const CANONICAL = new Map<string, string>(
  Object.entries(SUBJECT_SYNONYMS).flatMap(([key, names]) => names.map((name) => [normalize(name), key] as const)),
);

/** The canonical key for a subject name (case/punctuation-insensitive, synonyms folded); an unknown name keys as itself. */
export function canonicalSubject(name: string): string {
  const n = normalize(name);
  return CANONICAL.get(n) ?? n;
}

/** Language subjects are taught from books in that language; everything else from the English-medium edition. */
export function mediumFor(canonical: string): string {
  if (canonical === "hindi" || canonical === "sanskrit") return "Hindi";
  if (canonical === "urdu") return "Urdu";
  return "English";
}

/** Catalogue books for one (grade, subject): same class, same canonical subject, the subject's medium; verified first, then title. Empty when nothing matches. */
export function matchNcertBooks(
  grade: { code: string; displayName: string },
  subjectName: string,
  catalogue: readonly CatalogueBook[],
): CatalogueBook[] {
  const level = classNumberFromGrade(grade);
  if (level === null) return [];
  const key = canonicalSubject(subjectName);
  const medium = mediumFor(key);
  return catalogue
    .filter((b) => b.classLevel === level && b.medium === medium && canonicalSubject(b.subject) === key)
    .sort((a, b) => Number(b.verified) - Number(a.verified) || a.title.localeCompare(b.title));
}

/** The official chapter PDF URL: `{NN}` -> two-digit chapter number. */
export function chapterPdfUrl(pattern: string, chapterNo: number): string {
  return pattern.replace("{NN}", String(chapterNo).padStart(2, "0"));
}

/** Chapters 1..N; verified rows link each official chapter PDF, unverified rows link the official book page. */
export function chapterLinks(book: Pick<CatalogueBook, "chaptersCount" | "chapterPdfPattern" | "bookUrl" | "verified">): ChapterLink[] {
  return Array.from({ length: book.chaptersCount }, (_, i) => {
    const no = i + 1;
    return book.verified ? { no, url: chapterPdfUrl(book.chapterPdfPattern, no), kind: "pdf" as const } : { no, url: book.bookUrl, kind: "page" as const };
  });
}

export interface PairToMap {
  gradeId: string;
  gradeCode: string;
  gradeName: string;
  subjectId: string;
  subjectName: string;
}

/** The default mapping proposal: each (grade, subject) pair -> its matching catalogue codes (pairs with no match are left out). */
export function proposeMapping(pairs: readonly PairToMap[], catalogue: readonly CatalogueBook[]): { gradeId: string; subjectId: string; codes: string[] }[] {
  return pairs
    .map((p) => ({
      gradeId: p.gradeId,
      subjectId: p.subjectId,
      codes: matchNcertBooks({ code: p.gradeCode, displayName: p.gradeName }, p.subjectName, catalogue).map((b) => b.code),
    }))
    .filter((p) => p.codes.length > 0);
}
