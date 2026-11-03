Packet: MOD-T1 Module catalog + settings key
Files changed: src/lib/modules/catalog.ts (new), src/modules/core/schemas.ts (edited), tests/unit/modules-catalog.test.ts (new)
Behavior implemented: 33-module catalog with category labels, descriptions, core markers, defaults, and requires graph; isModuleEnabled() respects requires chains and defensive setting reads; InstitutionSettingsSchema validates modules as strict optional-key object; UpdateInstitutionSettingsSchema excludes modules; SetModuleEnabledSchema + input type.
Tests run: pnpm test tests/unit/modules-catalog.test.ts → 28 passed; pnpm test tests/unit/institution-settings.test.ts → 4 passed (28 new, 4 verified)
Tests not run and why: none—all acceptance criteria covered
Limitations / honesty label: none; no simulated/limited features
Security / integration risks: none—catalog is read-only; requires graph is acyclic; Zod strictly validates module keys; settings defensively read unknown structures
Follow-ups: T2–T14 gate on this catalog; MOD-T12 creates SQL mirror; no new debt
New dependencies: none
Assumptions made: partialRecord unavailable in installed zod; built strict object with all 27 optional keys instead
