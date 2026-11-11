import { describe, expect, it } from "vitest";
import {
  AddTextbookSchema,
  MAX_TEXTBOOK_FILE_BYTES,
  RequestTextbookFileSchema,
  SetTextbookLinkSchema,
  TextbookIdSchema,
} from "@/modules/textbooks/schemas";

const U = "00000000-0000-4000-8000-000000000001";

describe("textbook school link", () => {
  it("accepts https and clears with null", () => {
    expect(SetTextbookLinkSchema.safeParse({ textbookId: U, url: "https://publisher.example/ebook" }).success).toBe(true);
    expect(SetTextbookLinkSchema.safeParse({ textbookId: U, url: null }).success).toBe(true);
  });

  it("rejects javascript:, http:, data: and whitespace in the link", () => {
    for (const url of ["javascript:alert(1)", "http://example.com/b", "data:text/html,x", "https://exa mple.com", "https://example.com/a b", "", "   "]) {
      expect(SetTextbookLinkSchema.safeParse({ textbookId: U, url }).success, url).toBe(false);
    }
  });

  it("NCERT additions may carry a school link, https only", () => {
    const base = { gradeId: U, subjectId: U };
    expect(AddTextbookSchema.safeParse({ ...base, book: { source: "ncert", code: "fegp1", schoolUrl: "https://school.example/b.pdf" } }).success).toBe(true);
    expect(AddTextbookSchema.safeParse({ ...base, book: { source: "ncert", code: "fegp1", schoolUrl: "http://school.example" } }).success).toBe(false);
    expect(AddTextbookSchema.safeParse({ ...base, book: { source: "ncert", code: "fegp1", schoolUrl: "javascript:alert(1)" } }).success).toBe(false);
  });
});

describe("textbook PDF upload request", () => {
  const ok = { textbookId: U, fileName: "book.pdf", sizeBytes: 30 * 1048576 };

  it("takes a PDF up to 50 MB", () => {
    expect(MAX_TEXTBOOK_FILE_BYTES).toBe(52428800);
    expect(RequestTextbookFileSchema.safeParse(ok).success).toBe(true);
    expect(RequestTextbookFileSchema.safeParse({ ...ok, sizeBytes: MAX_TEXTBOOK_FILE_BYTES }).success).toBe(true);
  });

  it("refuses over 50 MB, empty, and any non-PDF type", () => {
    expect(RequestTextbookFileSchema.safeParse({ ...ok, sizeBytes: MAX_TEXTBOOK_FILE_BYTES + 1 }).success).toBe(false);
    expect(RequestTextbookFileSchema.safeParse({ ...ok, sizeBytes: 0 }).success).toBe(false);
    expect(RequestTextbookFileSchema.safeParse({ ...ok, mime: "image/png" }).success).toBe(false);
  });

  it("id-only actions take a uuid", () => {
    expect(TextbookIdSchema.safeParse({ textbookId: "nope" }).success).toBe(false);
  });
});
