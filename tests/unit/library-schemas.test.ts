import { describe, it, expect } from "vitest";
import {
  LIBRARY_SETTING_DEFAULTS,
  librarySettings,
  BookUpsertSchema,
  CopiesAddSchema,
  CopySetStatusSchema,
  LoanIssueSchema,
  LoanRenewSchema,
  LoanReturnSchema,
  CatalogQuerySchema,
  OverdueQuerySchema,
  MyLoansQuerySchema,
} from "../../src/modules/library/schemas";

describe("library schemas", () => {
  describe("LIBRARY_SETTING_DEFAULTS", () => {
    it("exports correct defaults", () => {
      expect(LIBRARY_SETTING_DEFAULTS).toEqual({
        loan_days: 14,
        fine_per_day: 1,
        max_loans_student: 2,
        max_loans_staff: 5,
      });
    });
  });

  describe("librarySettings", () => {
    it("returns defaults when settings is empty", () => {
      const result = librarySettings({});
      expect(result).toEqual(LIBRARY_SETTING_DEFAULTS);
    });

    it("parses valid library settings block", () => {
      const result = librarySettings({
        library: {
          loan_days: 21,
          fine_per_day: 2,
          max_loans_student: 3,
          max_loans_staff: 10,
        },
      });
      expect(result).toEqual({
        loan_days: 21,
        fine_per_day: 2,
        max_loans_student: 3,
        max_loans_staff: 10,
      });
    });

    it("applies defaults per key when library block is partial", () => {
      const result = librarySettings({
        library: {
          loan_days: 21,
        },
      });
      expect(result).toEqual({
        loan_days: 21,
        fine_per_day: 1,
        max_loans_student: 2,
        max_loans_staff: 5,
      });
    });

    it("returns defaults when library block is not an object", () => {
      const result = librarySettings({
        library: "invalid",
      });
      expect(result).toEqual(LIBRARY_SETTING_DEFAULTS);
    });

    it("returns defaults when library is null", () => {
      const result = librarySettings({
        library: null,
      });
      expect(result).toEqual(LIBRARY_SETTING_DEFAULTS);
    });

    it("never throws", () => {
      expect(() => librarySettings({ library: { loan_days: 999 } })).not.toThrow();
      expect(() => librarySettings({ library: { loan_days: -1 } })).not.toThrow();
      expect(() => librarySettings({ random: "data" })).not.toThrow();
    });
  });

  describe("BookUpsertSchema", () => {
    it("accepts valid book data with all fields", () => {
      const result = BookUpsertSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        title: "Malgudi Days",
        author: "R. K. Narayan",
        isbn: "978-81-7371-146-6",
      });
      expect(result.title).toBe("Malgudi Days");
      expect(result.isbn).toBe("9788173711466");
    });

    it("trims title and author", () => {
      const result = BookUpsertSchema.parse({
        title: "  Wings of Fire  ",
        author: "  Apj Abdul Kalam  ",
      });
      expect(result.title).toBe("Wings of Fire");
      expect(result.author).toBe("Apj Abdul Kalam");
    });

    it("accepts Hindi title", () => {
      const result = BookUpsertSchema.parse({
        title: "गोदान",
        author: "Premchand",
      });
      expect(result.title).toBe("गोदान");
    });

    it("normalizes ISBN: removes hyphens and spaces, upper-case X", () => {
      const result = BookUpsertSchema.parse({
        title: "A Book",
        author: "Author",
        isbn: "978-81-7371-146-6",
      });
      expect(result.isbn).toBe("9788173711466");
    });

    it("normalizes ISBN-10 with check digit", () => {
      const result = BookUpsertSchema.parse({
        title: "A Book",
        author: "Author",
        isbn: "81-7371-146-X",
      });
      expect(result.isbn).toBe("817371146X");
    });

    it("accepts ISBN as null", () => {
      const result = BookUpsertSchema.parse({
        title: "A Book",
        author: "Author",
        isbn: null,
      });
      expect(result.isbn).toBeNull();
    });

    it("omits isbn when not provided", () => {
      const result = BookUpsertSchema.parse({
        title: "A Book",
        author: "Author",
      });
      expect(result.isbn).toBeUndefined();
    });

    it("rejects invalid ISBN format", () => {
      expect(() =>
        BookUpsertSchema.parse({
          title: "A Book",
          author: "Author",
          isbn: "12345",
        })
      ).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        BookUpsertSchema.parse({
          title: "A Book",
          author: "Author",
          unknown: "field",
        })
      ).toThrow();
    });

    it("rejects title > 200 chars", () => {
      expect(() =>
        BookUpsertSchema.parse({
          title: "x".repeat(201),
          author: "Author",
        })
      ).toThrow();
    });

    it("rejects author > 120 chars", () => {
      expect(() =>
        BookUpsertSchema.parse({
          title: "A Book",
          author: "x".repeat(121),
        })
      ).toThrow();
    });
  });

  describe("CopiesAddSchema", () => {
    it("accepts valid accession numbers", () => {
      const result = CopiesAddSchema.parse({
        bookId: "550e8400-e29b-41d4-a716-446655440000",
        accessionNos: ["LIB-0001", "LIB-0002"],
      });
      expect(result.accessionNos).toEqual(["LIB-0001", "LIB-0002"]);
    });

    it("trims and upper-cases accession numbers", () => {
      const result = CopiesAddSchema.parse({
        bookId: "550e8400-e29b-41d4-a716-446655440000",
        accessionNos: ["  lib-0007  ", "LIB-0008"],
      });
      expect(result.accessionNos[0]).toBe("LIB-0007");
      expect(result.accessionNos[1]).toBe("LIB-0008");
    });

    it("rejects duplicate accession numbers", () => {
      expect(() =>
        CopiesAddSchema.parse({
          bookId: "550e8400-e29b-41d4-a716-446655440000",
          accessionNos: ["LIB-0001", "LIB-0001"],
        })
      ).toThrow();
    });

    it("rejects accession numbers > 30 chars", () => {
      expect(() =>
        CopiesAddSchema.parse({
          bookId: "550e8400-e29b-41d4-a716-446655440000",
          accessionNos: ["x".repeat(31)],
        })
      ).toThrow();
    });

    it("rejects invalid accession format", () => {
      expect(() =>
        CopiesAddSchema.parse({
          bookId: "550e8400-e29b-41d4-a716-446655440000",
          accessionNos: ["lib@0001"],
        })
      ).toThrow();
    });

    it("rejects > 50 accession numbers", () => {
      expect(() =>
        CopiesAddSchema.parse({
          bookId: "550e8400-e29b-41d4-a716-446655440000",
          accessionNos: Array.from({ length: 51 }, (_, i) => `LIB-${i.toString().padStart(4, "0")}`),
        })
      ).toThrow();
    });

    it("accepts exactly 50 accession numbers", () => {
      const result = CopiesAddSchema.parse({
        bookId: "550e8400-e29b-41d4-a716-446655440000",
        accessionNos: Array.from({ length: 50 }, (_, i) => `LIB-${i.toString().padStart(4, "0")}`),
      });
      expect(result.accessionNos).toHaveLength(50);
    });
  });

  describe("CopySetStatusSchema", () => {
    it("accepts active status", () => {
      const result = CopySetStatusSchema.parse({
        copyId: "550e8400-e29b-41d4-a716-446655440000",
        status: "active",
      });
      expect(result.status).toBe("active");
    });

    it("accepts withdrawn status", () => {
      const result = CopySetStatusSchema.parse({
        copyId: "550e8400-e29b-41d4-a716-446655440000",
        status: "withdrawn",
      });
      expect(result.status).toBe("withdrawn");
    });

    it("rejects invalid status", () => {
      expect(() =>
        CopySetStatusSchema.parse({
          copyId: "550e8400-e29b-41d4-a716-446655440000",
          status: "invalid",
        })
      ).toThrow();
    });
  });

  describe("LoanIssueSchema", () => {
    it("accepts issue with studentId only", () => {
      const result = LoanIssueSchema.parse({
        accessionNo: "LIB-0001",
        studentId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.studentId).toBeDefined();
      expect(result.staffId).toBeUndefined();
    });

    it("accepts issue with staffId only", () => {
      const result = LoanIssueSchema.parse({
        accessionNo: "LIB-0001",
        staffId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.staffId).toBeDefined();
      expect(result.studentId).toBeUndefined();
    });

    it("rejects both studentId and staffId", () => {
      expect(() =>
        LoanIssueSchema.parse({
          accessionNo: "LIB-0001",
          studentId: "550e8400-e29b-41d4-a716-446655440000",
          staffId: "550e8400-e29b-41d4-a716-446655440001",
        })
      ).toThrow();
    });

    it("rejects neither studentId nor staffId", () => {
      expect(() =>
        LoanIssueSchema.parse({
          accessionNo: "LIB-0001",
        })
      ).toThrow();
    });
  });

  describe("LoanRenewSchema", () => {
    it("accepts valid accession number", () => {
      const result = LoanRenewSchema.parse({
        accessionNo: "LIB-0001",
      });
      expect(result.accessionNo).toBe("LIB-0001");
    });
  });

  describe("LoanReturnSchema", () => {
    it("accepts accession with default waiveFine", () => {
      const result = LoanReturnSchema.parse({
        accessionNo: "LIB-0001",
      });
      expect(result.accessionNo).toBe("LIB-0001");
      expect(result.waiveFine).toBe(false);
    });

    it("accepts explicit waiveFine", () => {
      const result = LoanReturnSchema.parse({
        accessionNo: "LIB-0001",
        waiveFine: true,
      });
      expect(result.waiveFine).toBe(true);
    });
  });

  describe("CatalogQuerySchema", () => {
    it("accepts empty query", () => {
      const result = CatalogQuerySchema.parse({});
      expect(result.q).toBeUndefined();
      expect(result.limit).toBeUndefined();
    });

    it("accepts query string", () => {
      const result = CatalogQuerySchema.parse({
        q: "malgudi",
      });
      expect(result.q).toBe("malgudi");
    });

    it("trims query string", () => {
      const result = CatalogQuerySchema.parse({
        q: "  malgudi  ",
      });
      expect(result.q).toBe("malgudi");
    });

    it("rejects query > 60 chars", () => {
      expect(() =>
        CatalogQuerySchema.parse({
          q: "x".repeat(61),
        })
      ).toThrow();
    });

    it("accepts limit 1–100", () => {
      const result = CatalogQuerySchema.parse({
        limit: 50,
      });
      expect(result.limit).toBe(50);
    });

    it("rejects limit < 1", () => {
      expect(() =>
        CatalogQuerySchema.parse({
          limit: 0,
        })
      ).toThrow();
    });

    it("rejects limit > 100", () => {
      expect(() =>
        CatalogQuerySchema.parse({
          limit: 101,
        })
      ).toThrow();
    });
  });

  describe("OverdueQuerySchema", () => {
    it("accepts empty query", () => {
      const result = OverdueQuerySchema.parse({});
      expect(result.limit).toBeUndefined();
    });

    it("accepts limit 1–500", () => {
      const result = OverdueQuerySchema.parse({
        limit: 250,
      });
      expect(result.limit).toBe(250);
    });

    it("rejects limit > 500", () => {
      expect(() =>
        OverdueQuerySchema.parse({
          limit: 501,
        })
      ).toThrow();
    });
  });

  describe("MyLoansQuerySchema", () => {
    it("accepts empty query", () => {
      const result = MyLoansQuerySchema.parse({});
      expect(result.studentId).toBeUndefined();
    });

    it("accepts studentId", () => {
      const result = MyLoansQuerySchema.parse({
        studentId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.studentId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rejects invalid UUID", () => {
      expect(() =>
        MyLoansQuerySchema.parse({
          studentId: "not-a-uuid",
        })
      ).toThrow();
    });
  });
});
