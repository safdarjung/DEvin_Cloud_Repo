# F-BE-14 Fixture: Marketplace

Packet: F-BE-14 Fixture `marketplace`
Files: `src/modules/fabric/demo/marketplace.ts`, `tests/unit/fabric-fixtures/marketplace.test.ts`
Tests: ✓ 14/14 pass; deterministic; 24 modules (10 categories, ≥6 featured, mix of pricing); 5 installed + 1 pending_approval.
Verification: `pnpm lint` clean, `pnpm test -- tests/unit/fabric-fixtures/marketplace.test.ts` all pass.
Behavior: Marketplace fixture generates real-looking modules (Fee Reminder, CBSE Reports, Transport GPS, Attendance Warnings, Timetable Optimizer, etc.) with dependencies, permissions, products, and 2-3 changelog entries per module. Initial installs reference valid module IDs; status validation (5 installed, 1 pending_approval).
Limitations: Demo fixture only; simulated WhatsApp notifications. No DB integration — Phase 1 static.
Follow-ups: None.
