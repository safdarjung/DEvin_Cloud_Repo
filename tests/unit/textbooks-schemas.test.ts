import { describe, expect, it } from "vitest";
import { matchesMagic } from "@/modules/textbooks/file-check";
import {
  AddTextbookSchema,
  AttachMaterialSchema,
  RequestMaterialUploadSchema,
  SetChapterTitlesSchema,
  SetUnitChapterSchema,
} from "@/modules/textbooks/schemas";
import { StudentSourceSchema } from "@/modules/study/schemas";

const U = "00000000-0000-4000-8000-000000000001";

describe("textbook schemas", () => {
  it("custom books take https links only; NCERT codes are catalogue-shaped", () => {
    const base = { gradeId: U, subjectId: U };
    expect(AddTextbookSchema.safeParse({ ...base, book: { source: "custom", title: "RS Aggarwal", url: "https://example.com/b" } }).success).toBe(true);
    for (const url of ["http://example.com", "javascript:alert(1)", "data:text/html,x"]) {
      expect(AddTextbookSchema.safeParse({ ...base, book: { source: "custom", title: "X", url } }).success).toBe(false);
    }
    expect(AddTextbookSchema.safeParse({ ...base, book: { source: "ncert", code: "fegp1" } }).success).toBe(true);
    expect(AddTextbookSchema.safeParse({ ...base, book: { source: "ncert", code: "../etc" } }).success).toBe(false);
  });

  it("chapter titles are keyed 1-99", () => {
    expect(SetChapterTitlesSchema.safeParse({ textbookId: U, titles: { "1": "Patterns", "12": "" } }).success).toBe(true);
    expect(SetChapterTitlesSchema.safeParse({ textbookId: U, titles: { "0": "x" } }).success).toBe(false);
    expect(SetChapterTitlesSchema.safeParse({ textbookId: U, titles: { "100": "x" } }).success).toBe(false);
  });

  it("a unit chapter needs a book unless it is being cleared", () => {
    expect(SetUnitChapterSchema.safeParse({ unitId: U, chapterNo: null }).success).toBe(true);
    expect(SetUnitChapterSchema.safeParse({ unitId: U, chapterNo: 4 }).success).toBe(false);
    expect(SetUnitChapterSchema.safeParse({ unitId: U, textbookId: U, chapterNo: 4 }).success).toBe(true);
    expect(SetUnitChapterSchema.safeParse({ unitId: U, textbookId: U, chapterNo: 0 }).success).toBe(false);
  });
});

describe("material schemas", () => {
  const file = { fileName: "notes.pdf", mime: "application/pdf", sizeBytes: 1000 };
  it("accepts PDF/JPEG/PNG up to 10 MB, with or without a target", () => {
    expect(RequestMaterialUploadSchema.safeParse(file).success).toBe(true);
    expect(RequestMaterialUploadSchema.safeParse({ ...file, mime: "image/png", target: { gradeId: U, subjectId: U, unitId: U } }).success).toBe(true);
    expect(RequestMaterialUploadSchema.safeParse({ ...file, sizeBytes: 10485760 }).success).toBe(true);
  });
  it("refuses other types, empty and oversized files, and unknown keys", () => {
    expect(RequestMaterialUploadSchema.safeParse({ ...file, mime: "text/html" }).success).toBe(false);
    expect(RequestMaterialUploadSchema.safeParse({ ...file, mime: "text/csv" }).success).toBe(false);
    expect(RequestMaterialUploadSchema.safeParse({ ...file, sizeBytes: 0 }).success).toBe(false);
    expect(RequestMaterialUploadSchema.safeParse({ ...file, sizeBytes: 10485761 }).success).toBe(false);
    expect(RequestMaterialUploadSchema.safeParse({ ...file, ownerKind: "staff" }).success).toBe(false);
  });
  it("attach takes private, class or suggest", () => {
    const base = { materialId: U, gradeId: U, subjectId: U };
    for (const share of ["private", "class", "suggest"]) expect(AttachMaterialSchema.safeParse({ ...base, share }).success).toBe(true);
    expect(AttachMaterialSchema.safeParse({ ...base, share: "public" }).success).toBe(false);
  });
});

describe("matchesMagic", () => {
  it("checks the first bytes against the declared type", () => {
    expect(matchesMagic("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(matchesMagic("application/pdf", new TextEncoder().encode("<html><b"))).toBe(false);
    expect(matchesMagic("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matchesMagic("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesMagic("image/jpeg", new Uint8Array([0x25, 0x50, 0x44]))).toBe(false);
    expect(matchesMagic("text/csv", new TextEncoder().encode("a,b,c"))).toBe(false);
    expect(matchesMagic("application/pdf", new Uint8Array([0x25]))).toBe(false);
  });
});

describe("study textbook source", () => {
  it("is a unit plus optional pasted text", () => {
    expect(StudentSourceSchema.safeParse({ kind: "textbook", unitId: U }).success).toBe(true);
    expect(StudentSourceSchema.safeParse({ kind: "textbook", unitId: U, text: "Chapter passage" }).success).toBe(true);
    expect(StudentSourceSchema.safeParse({ kind: "textbook", unitId: U, bookUrl: "https://x" }).success).toBe(false);
  });
});
