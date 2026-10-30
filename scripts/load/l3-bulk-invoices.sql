-- T-043 L3 — EXPLAIN ANALYZE of app.generate_invoice (06 §W9 / 0008, 0024,
-- 0044) for one student/term pair. Run only inside a transaction that gets
-- rolled back afterward (l3-bulk-invoices.ts does this) — the function
-- writes rows, so a plain run outside a transaction would create a real
-- invoice.
-- $1 = student_id, $2 = term_id
explain (analyze, buffers, format text)
select app.generate_invoice($1::uuid, $2::uuid);
