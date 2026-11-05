# X02-T6 Report: ID card HTML renderer + CSP `img-src data:`

**Packet:** X02-T6  
**Files changed:**
- `src/modules/certificates/id-card-html.ts` (new)
- `src/lib/http/html.ts` (CSP string only)
- `tests/unit/id-card-html.test.ts` (new)
- `tests/unit/html-response.test.ts` (CSP expectation updated)

**Behavior implemented:**
- Pure renderer `renderIdCardsHtml()` outputs CR80 ID cards (85.6 × 54 mm), 2 per row on A4.
- `formatPhoneIN()` formats 10-digit phone as `+91 XXXXX XXXXX`.
- Photo validation: only `data:image/(png|jpeg);base64,…` URIs embedded; invalid/missing → initials placeholder.
- All names and phone values escaped via `escapeHtml`.
- Footer shows "showing X of Y" and "N photos over 50 KB not shown" when applicable.
- CSP updated: `img-src data:` added to allow embedded data URIs.

**Tests run:**
- `pnpm test tests/unit/id-card-html.test.ts`: 14 PASS
- `pnpm test tests/unit/html-response.test.ts`: 4 PASS (CSP updated)
- `pnpm typecheck`: ✓ clean
- `pnpm lint`: ✓ clean

**Tests not run and why:** None; all specified and integration tests covered.

**Limitations / honesty label:** None. Renderer is pure, uses existing `escapeHtml` and `formatDateIN` utilities.

**Security / integration risks:** None. Photo URIs validated against strict regex, no scripts in output, CSP tightened.

**Follow-ups:** T9 (id-cards query) will call this renderer with populated cards and photos; T8 (certificate queries) already tested separately.

**New dependencies:** None.

**Assumptions made:** `board` parameter reserved for future use (not on card per rulings §ID cards); `formatDateIN` already available from T5.
