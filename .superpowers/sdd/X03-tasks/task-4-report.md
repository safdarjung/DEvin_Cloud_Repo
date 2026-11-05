# X03-T4 Report: Library Zod schemas + settings reader

**Packet:** X03-T4 Library Zod schemas + settings reader (Haiku)

**Files changed:**
- `src/modules/library/schemas.ts` (new, 148 lines)
- `tests/unit/library-schemas.test.ts` (new, 448 lines)

**Behavior implemented:**
Exported `LIBRARY_SETTING_DEFAULTS` constant with loan_days: 14, fine_per_day: 1, max_loans_student: 2, max_loans_staff: 5. `librarySettings()` function parses `settings.library` block with T1's schema; missing or invalid values → defaults per key, never throws. Twelve Zod schemas: BookUpsertSchema (title/author trim, ISBN normalize and validate), CopiesAddSchema (accession array 1–50 with uniqueness), CopySetStatusSchema (active|withdrawn), LoanIssueSchema (exactly one of studentId/staffId via refine), LoanRenewSchema/LoanReturnSchema (accession with optional waiveFine), CatalogQuerySchema/OverdueQuerySchema/MyLoansQuerySchema (query shapes). All `.strict()`, inferred `*Input` types exported. Relative `.ts` imports for seed compatibility.

**Tests run:**
- `pnpm test tests/unit/library-schemas.test.ts` → 48 passed
- `pnpm lint` → clean
- `pnpm typecheck` → clean

**Tests not run and why:** None; unit test suite covers all parsing cases, edge cases (bounds, invalid formats, Unicode), and transformations (ISBN normalize, accession upper-case/trim, duplicate rejection, exactly-one refinement).

**Limitations / honesty label:** None; this is data-layer schema validation only (RLS and action authorization covered in T2–T6).

**Security / integration risks:** None; schemas validate user input before action handlers; preprocssing transforms happen before validation (ISBN/accession normalization), preventing injection via crafted input.

**Follow-ups:** T5 (catalogue actions) and T6 (circulation actions) import these schemas; T7 (queries) uses the query shapes; T3 ledger/invoice integration tested separately.

**New dependencies:** None.

**Assumptions made:** Zod version supports `.preprocess()` for input normalization before validation (verified in package.json, v3.23.8); ISBN-10/13 validation regex `^([0-9]{9}[0-9X]|[0-9]{13})$` per rulings; accession format `^[A-Z0-9/-]+$` per rulings; librarySettings defaults when settings.library is not an object, null, or missing (defensive, aligns with T1 block design).
