import { describe, expect, it } from "vitest";
import catalogueJson from "../../scripts/ncert/ncert-catalogue.json";
import { buildCatalogueSql } from "../../scripts/ncert/build-migration";
import {
  canonicalSubject,
  chapterLinks,
  chapterPdfUrl,
  classNumberFromGrade,
  matchNcertBooks,
  proposeMapping,
  type CatalogueBook,
} from "@/modules/textbooks/ncert";

const book = (over: Partial<CatalogueBook>): CatalogueBook => ({
  code: "fegp1",
  classLevel: 6,
  subject: "Mathematics",
  title: "Ganita Prakash",
  medium: "English",
  chaptersCount: 10,
  bookUrl: "https://ncert.nic.in/textbook.php?fegp1=0-10",
  chapterPdfPattern: "https://ncert.nic.in/textbook/pdf/fegp1{NN}.pdf",
  verified: true,
  ...over,
});

const catalogue: CatalogueBook[] = (catalogueJson.books as { class: number | string; subject: string; title: string; medium: string; code: string; chapters_count: number; book_url: string; chapter_pdf_pattern: string; verified: boolean }[]).map((b) => ({
  code: b.code,
  classLevel: typeof b.class === "number" ? b.class : null,
  subject: b.subject,
  title: b.title,
  medium: b.medium,
  chaptersCount: b.chapters_count,
  bookUrl: b.book_url,
  chapterPdfPattern: b.chapter_pdf_pattern,
  verified: b.verified,
}));

describe("classNumberFromGrade", () => {
  it("reads roman codes, roman or arabic display names, code first", () => {
    expect(classNumberFromGrade({ code: "VI", displayName: "Grade VI" })).toBe(6);
    expect(classNumberFromGrade({ code: "G10", displayName: "Class 10" })).toBe(10);
    expect(classNumberFromGrade({ code: "c-xii", displayName: "Senior" })).toBe(12);
    expect(classNumberFromGrade({ code: "STD", displayName: "Std 4" })).toBe(4);
    expect(classNumberFromGrade({ code: "XI-A", displayName: "Eleven" })).toBe(11);
  });

  it("returns null for pre-primary and unnamed grades", () => {
    expect(classNumberFromGrade({ code: "LKG", displayName: "Lower KG" })).toBeNull();
    expect(classNumberFromGrade({ code: "KG1", displayName: "KG 1" })).toBeNull();
    expect(classNumberFromGrade({ code: "NUR", displayName: "Nursery" })).toBeNull();
    expect(classNumberFromGrade({ code: "SR", displayName: "Senior wing" })).toBeNull();
    expect(classNumberFromGrade({ code: "13", displayName: "Class 13" })).toBeNull();
  });
});

describe("canonicalSubject", () => {
  it("folds case, punctuation and synonyms", () => {
    expect(canonicalSubject("Maths")).toBe(canonicalSubject("MATHEMATICS"));
    expect(canonicalSubject("EVS")).toBe(canonicalSubject("The World Around Us"));
    expect(canonicalSubject("Environmental Studies")).toBe("evs");
    expect(canonicalSubject("S.St")).toBe(canonicalSubject("Social Science"));
    expect(canonicalSubject("Physical Education")).toBe(canonicalSubject("Physical Education and Well Being"));
    expect(canonicalSubject("Pol. Sci.")).toBe("political science");
    expect(canonicalSubject("Accounts")).toBe("accountancy");
    expect(canonicalSubject("BST")).toBe("business studies");
    expect(canonicalSubject("Robotics")).toBe("robotics");
  });
});

describe("matchNcertBooks", () => {
  it("matches the real catalogue by class and synonym, verified first", () => {
    expect(matchNcertBooks({ code: "VI", displayName: "Grade VI" }, "Maths", catalogue).map((b) => b.code)).toEqual(["fegp1"]);
    expect(matchNcertBooks({ code: "III", displayName: "Grade III" }, "EVS", catalogue).map((b) => b.code)).toEqual(["ceev1"]);
    const x = matchNcertBooks({ code: "X", displayName: "Grade X" }, "English", catalogue);
    expect(x.map((b) => b.verified)).toEqual([true, true, false]);
    expect(x.at(-1)?.code).toBe("jewe2");
  });

  it("uses the language's own medium for Hindi/Sanskrit and English medium otherwise", () => {
    expect(matchNcertBooks({ code: "IX", displayName: "Grade IX" }, "Hindi", catalogue).every((b) => b.medium === "Hindi")).toBe(true);
    expect(matchNcertBooks({ code: "IX", displayName: "Grade IX" }, "Sanskrit", catalogue).map((b) => b.code)).toEqual(["ihsh1"]);
    expect(matchNcertBooks({ code: "IX", displayName: "Grade IX" }, "Science", catalogue).every((b) => b.medium === "English")).toBe(true);
  });

  it("puts verified rows before unverified ones", () => {
    const rows = [book({ code: "b1", title: "A", verified: false }), book({ code: "b2", title: "Z", verified: true })];
    expect(matchNcertBooks({ code: "VI", displayName: "VI" }, "Mathematics", rows).map((b) => b.code)).toEqual(["b2", "b1"]);
  });

  it("no match gives none", () => {
    expect(matchNcertBooks({ code: "I", displayName: "Grade I" }, "Computer Science", catalogue)).toEqual([]);
    expect(matchNcertBooks({ code: "LKG", displayName: "LKG" }, "English", catalogue)).toEqual([]);
    expect(proposeMapping([{ gradeId: "g", gradeCode: "LKG", gradeName: "LKG", subjectId: "s", subjectName: "English" }], catalogue)).toEqual([]);
  });

  it("proposes codes per (grade, subject) pair", () => {
    expect(proposeMapping([{ gradeId: "g6", gradeCode: "VI", gradeName: "Grade VI", subjectId: "sci", subjectName: "science" }], catalogue)).toEqual([
      { gradeId: "g6", subjectId: "sci", codes: ["fecu1"] },
    ]);
  });
});

describe("chapter URLs", () => {
  it("zero-pads NN", () => {
    expect(chapterPdfUrl("https://ncert.nic.in/textbook/pdf/fegp1{NN}.pdf", 4)).toBe("https://ncert.nic.in/textbook/pdf/fegp104.pdf");
    expect(chapterPdfUrl("https://ncert.nic.in/textbook/pdf/fegp1{NN}.pdf", 12)).toBe("https://ncert.nic.in/textbook/pdf/fegp112.pdf");
  });

  it("verified books link chapter PDFs; unverified books link the official book page", () => {
    const pdfs = chapterLinks(book({ chaptersCount: 3 }));
    expect(pdfs).toEqual([
      { no: 1, url: "https://ncert.nic.in/textbook/pdf/fegp101.pdf", kind: "pdf" },
      { no: 2, url: "https://ncert.nic.in/textbook/pdf/fegp102.pdf", kind: "pdf" },
      { no: 3, url: "https://ncert.nic.in/textbook/pdf/fegp103.pdf", kind: "pdf" },
    ]);
    const page = chapterLinks(book({ chaptersCount: 2, verified: false }));
    expect(page.every((c) => c.kind === "page" && c.url === "https://ncert.nic.in/textbook.php?fegp1=0-10")).toBe(true);
  });
});

describe("catalogue migration builder", () => {
  it("escapes quotes and maps the combined XI-XII class to a null level", () => {
    const out = buildCatalogueSql(
      [
        { class: 6, subject: "Arts", title: "Kriti's Book", medium: "English", code: "fekr1", chapters_count: 22, book_url: "u", chapter_pdf_pattern: "p", prelims_pdf: null, verified: true },
        { class: "11-12 combined", subject: "Hindi", title: "Abhivyakti", medium: "Hindi", code: "kham1", chapters_count: 5, book_url: "u", chapter_pdf_pattern: "p", prelims_pdf: "q", verified: false },
      ],
      "2026-11-11",
    );
    expect(out).toContain("'Kriti''s Book'");
    expect(out).toContain("('kham1', '11-12', null, 'Hindi'");
    expect(out).toContain("on conflict (code) do update set");
    expect(() => buildCatalogueSql([{ ...{ class: 13, subject: "x", title: "x", medium: "English", code: "x", chapters_count: 1, book_url: "u", chapter_pdf_pattern: "p", prelims_pdf: null, verified: false } }], "2026-11-11")).toThrow();
  });
});
