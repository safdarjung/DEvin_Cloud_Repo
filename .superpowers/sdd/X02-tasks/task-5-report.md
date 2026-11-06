Packet: X02-T5 Certificate HTML renderer
Files changed: 
- src/modules/certificates/certificate-html.ts (new)
- tests/unit/certificate-html.test.ts (new)

Behavior implemented:
Pure HTML renderers for bonafide, character, and transfer certificates. Exported: formatDateIN (ISO → DD-MM-YYYY), dateInWords (ISO → English words), relationPhrase (gender + relationship → phrase), formatInr (number → ₹1,23,456.00), renderCertificateHtml (snapshot → HTML5 document). Bonafide shows purpose and DOB in words; character uses "is" (active) or "was" (withdrawn); transfer renders CBSE-style table with TC fields, dues status, and relation phrase. All HTML escaped; no scripts, no external URLs, @page A4 15mm margins.

Tests run: `pnpm test tests/unit/certificate-html.test.ts` → 24 passed
- dateInWords 4 tests (ISO dates 1900–2099)
- formatDateIN 1 test
- relationPhrase 4 tests (M/F, father/mother/null, legal_guardian/grandparent/other)
- formatInr 3 tests (basic, zero, floats)
- renderCertificateHtml 12 tests (XSS escape, bonafide purpose+DOB, character active/withdrawn, TC dues 0/1500, @page rule, no scripts, no URLs, header, serial, signatures, TC fields, relation phrase, HTML5 tags)

Lint/typecheck: `pnpm lint` + `pnpm typecheck` clean

Limitations / honesty label:
Module is pure (no imports except escapeHtml and type defs); renders frozen snapshot only; no CSP update here (T6 task). Dates 1900–2099 only per rulings. TC kind="transferred_out" only shows destination_school per rulings.

Security / integration risks: None. Pure functions, inline CSS, XSS-escaped all user strings, no dynamic SQL or DOM.

Follow-ups: None; ready for T6 (ID card renderer + CSP).

New dependencies: None.

Assumptions made: escapeHtml exported from exams module (M11); CertificateSnapshot/TcSnapshot types from schemas.ts (T4).
