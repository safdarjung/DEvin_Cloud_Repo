// Subject catalog by grade group (12 §2 Domain row: PRT/TGT/PGT by wing;
// subjects by grade group) and curriculum unit templates (05 §8.1:
// `UNIT-X-MATH-3` "Quadratic Equations" for Grade X Mathematics -> the
// Mathematics template's 3rd entry, reused for every grade that teaches it).

export interface SubjectDef {
  code: string;
  name: string;
  kind: "scholastic" | "co_scholastic" | "skill" | "language";
}

const CORE_SUBJECTS: SubjectDef[] = [
  { code: "ENG", name: "English", kind: "language" },
  { code: "HIN", name: "Hindi", kind: "language" },
  { code: "MATH", name: "Mathematics", kind: "scholastic" },
  { code: "COMP", name: "Computer Science", kind: "skill" },
  { code: "ART", name: "Art", kind: "co_scholastic" },
  { code: "PE", name: "Physical Education", kind: "co_scholastic" },
];

const EVS: SubjectDef = { code: "EVS", name: "Environmental Studies", kind: "scholastic" };
const SCIENCE: SubjectDef = { code: "SCI", name: "Science", kind: "scholastic" };
const SOCIAL_SCIENCE: SubjectDef = { code: "SST", name: "Social Science", kind: "scholastic" };
const SANSKRIT: SubjectDef = { code: "SANS", name: "Sanskrit", kind: "language" };
const IT: SubjectDef = { code: "IT", name: "Information Technology", kind: "skill" };

const SCIENCE_STREAM: SubjectDef[] = [
  { code: "ENG", name: "English", kind: "language" },
  { code: "PHY", name: "Physics", kind: "scholastic" },
  { code: "CHEM", name: "Chemistry", kind: "scholastic" },
  { code: "MATH", name: "Mathematics", kind: "scholastic" },
  { code: "BIO", name: "Biology", kind: "scholastic" },
];

const COMMERCE_STREAM: SubjectDef[] = [
  { code: "ENG", name: "English", kind: "language" },
  { code: "ACC", name: "Accountancy", kind: "scholastic" },
  { code: "BST", name: "Business Studies", kind: "scholastic" },
  { code: "ECO", name: "Economics", kind: "scholastic" },
  { code: "MATH", name: "Mathematics", kind: "scholastic" },
];

const HUMANITIES_STREAM: SubjectDef[] = [
  { code: "ENG", name: "English", kind: "language" },
  { code: "HIST", name: "History", kind: "scholastic" },
  { code: "POLSCI", name: "Political Science", kind: "scholastic" },
  { code: "GEO", name: "Geography", kind: "scholastic" },
  { code: "ECO", name: "Economics", kind: "scholastic" },
];

/** Subjects taught for a given grade group + section name (streams split by A/D=science, B/E=commerce, C/F=humanities). */
export function subjectsFor(gradeGroup: string, sectionName: string): SubjectDef[] {
  if (gradeGroup === "primary") {
    return [...CORE_SUBJECTS, EVS];
  }
  if (gradeGroup === "middle") {
    return [...CORE_SUBJECTS, SCIENCE, SOCIAL_SCIENCE];
  }
  if (gradeGroup === "secondary") {
    return [...CORE_SUBJECTS, SCIENCE, SOCIAL_SCIENCE, SANSKRIT, IT];
  }
  // senior_secondary: stream by section letter.
  if (sectionName === "B" || sectionName === "E") return COMMERCE_STREAM;
  if (sectionName === "C" || sectionName === "F") return HUMANITIES_STREAM;
  return SCIENCE_STREAM;
}

const GENERIC_UNIT_TITLES = [
  "Foundations and Key Concepts",
  "Core Principles and Methods",
  "Applied Problems and Case Studies",
  "Review and Integrated Practice",
];

const UNIT_TITLES_BY_SUBJECT: Record<string, string[]> = {
  MATH: ["Numbers and Operations", "Algebra Basics", "Quadratic Equations", "Geometry and Mensuration"],
  ENG: ["Reading Comprehension", "Grammar and Usage", "Composition and Writing", "Literature Appreciation"],
  HIN: ["Vyakaran (Grammar)", "Gadya (Prose)", "Padya (Poetry)", "Rachna (Composition)"],
  SCI: ["Matter and Materials", "Living World", "Forces and Energy", "Our Environment"],
  EVS: ["Family and Surroundings", "Plants and Animals", "Food and Health", "Air, Water and Weather"],
  SST: ["History and Civics", "Geography Basics", "Our Government", "Resources and Economy"],
  COMP: ["Computer Basics", "Working with Documents", "Logic and Algorithms", "Internet and Safety"],
};

export function curriculumUnits(subject: SubjectDef, gradeDisplay: string): { title: string; description: string }[] {
  const titles = UNIT_TITLES_BY_SUBJECT[subject.code] ?? GENERIC_UNIT_TITLES.map((t) => `${t} in ${subject.name}`);
  return titles.map((title) => ({
    title,
    description:
      `Covers "${title}" for ${subject.name} in ${gradeDisplay}. Introduces key concepts, worked examples, ` +
      `and practice questions suitable as a source for AI-generated quizzes and homework assignments.`,
  }));
}
