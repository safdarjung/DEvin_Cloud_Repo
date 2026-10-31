# 09 — Twenty-day plan

Day 1 = first implementation day after the user approves this package. Feature coding: Days 2–14 (13 days). Checkpoints (full suite by the lead): Days 4, 9, 13, 16, 18. Load tests: Days 15 and 17. Task details: `10-backlog-index.md` and `tasks/`.

## 1. Critical path

scaffold (T-001/002) → foundation helpers + core schema (T-003/004) → auth + tenant layout + permission kit (T-006/007/008) → test harness (T-009) → **Checkpoint 1 (Day 4)** → people + academics schema (T-010/011) → seed framework + people/academics seed (T-012/013, Day 6) → lanes → exams publish/recheck (T-019/020) and enrolment (T-028) → **Checkpoint 3 feature freeze (Day 13)** → E2E narrative (T-041) → integration Day 16 → security Day 17 → deploy Day 18 → rehearsal Day 19 → buffer Day 20.

Anything on this path that slips one day consumes the Day 20 buffer; a second day of slip triggers the fallback ladder (§7).

## 2. Day-by-day

| Day | Lead / foundation | Lane A — academics, attendance, exams | Lane B — website, admissions | Lane C — finance (then portal, E2E) | Lane D — AI, jobs, notifications, dashboard | Gate / checkpoint |
|---|---|---|---|---|---|---|
| 1 | T-001 scaffold → T-002 Supabase local + CI | — | — | — | — | `pnpm dev`, `pnpm db:start`, CI green on empty suite |
| 2 | T-003 helpers → T-004 core schema | — | T-006 auth + login + proxy | — | T-008 permission matrix + action kit | — |
| 3 | T-005 platform tables; review T-006/008 | — | T-007 tenant layout + context | — | T-009 test harness + security scaffold | — |
| 4 | **Checkpoint 1**: full suite, fix, merge | T-011 academics schema | T-010 people schema | — | — | Foundation merged; RLS generated suite runs over core tables |
| 5 | T-012 seed framework + core seed + reset | T-014 attendance schema | T-023 website schema; T-026 admissions schema | T-030 finance schema + functions (incl. `enrol_applicant`) | T-035 AI gateway + providers | All 10 migrations reserved; 0006–0010 merged by end of day |
| 6 | T-013 seed people + academics (critical) | T-015 attendance UI + actions | T-024 public site + enquiry route | T-030 cont. + function tests | T-035 cont. + policy tests | Seed lands: ≈3,024 students visible |
| 7 | Reviews (RLS, finance fns, gateway) | T-015 cont.; T-016 seed attendance | T-024 cont. | T-031 fee structures + invoice generation | T-037 jobs runner | — |
| 8 | Reviews | T-017 exams schema + functions | T-025 website editor | T-031 cont. | T-038 notifications + simulated channels + message log | — |
| 9 | **Checkpoint 2**: full suite, demo:reset, J-00/J-01/J-02/J-06 | T-018 exam setup + marks entry | T-027 admissions CRM UI | T-032 payments, receipts, ledger UI | T-022 assignments module | Half the narrative clickable |
| 10 | Reviews | T-019 publish + report card | T-027 cont. | T-032 cont.; T-033 seed finance | T-036 AI quiz route + review UI | — |
| 11 | Reviews (exams, enrolment) | T-020 recheck workflow | T-028 enrolment action + student profile | T-034 guardian portal shell + composition | T-036 cont. | — |
| 12 | Reviews | T-020 cont.; T-021 seed exams | T-028 cont.; T-029 seed admissions | T-034 cont. | T-039 principal dashboard | — |
| 13 | **Checkpoint 3 (feature freeze)**: full suite, J-01..J-13 attempted | Bug fixes | Bug fixes | T-041 E2E narrative spec | T-039 cont.; T-040 AI bench (P1) | No new features after today |
| 14 | Integration fixes; a11y + responsive smoke | Fixes | Fixes | T-041 cont.; T-043 load scripts | Fixes | All journeys green locally |
| 15 | **Load test 1** (L1–L5 local); fix hot spots | — | — | — | — | Results in `results/load-15.md` |
| 16 | **Checkpoint 4 (integration)**: demo:reset → full narrative twice | — | — | — | — | Narrative < 25 min |
| 17 | **Security day**: T-042 complete suite, review findings, fixes; **Load test 2** | — | — | — | — | Security suite green, no CRITICAL/HIGH |
| 18 | **Deploy**: T-044 hosted Supabase (ap-south-1) + Vercel; migrations, seed, backup/restore once; **Checkpoint 5** on hosted | — | — | — | — | Hosted narrative green |
| 19 | **Rehearsal**: T-045 script run twice from reset; polish copy, labels, charts | — | — | — | — | Demo-ready gate G-2 |
| 20 | Buffer / fallback | — | — | — | — | — |

Agents: one lead (reviews, checkpoints, foundation Days 1–6) + four lane agents from Day 4/5. Lane C finishes finance by Day 10 and takes the guardian portal, E2E, and load scripts.

## 3. Lanes and file ownership

| Lane | Modules / paths owned | Migrations | Seed sections |
|---|---|---|---|
| A | `src/modules/attendance`, `src/modules/exams`, pages `/attendance`, `/exams` | 0006, 0009 | `attendance.ts`, `exams.ts` |
| B | `src/modules/website`, `src/modules/admissions`, `src/app/s/**`, `src/app/api/public/**`, pages `/website`, `/admissions`; `src/modules/people/components/StudentProfile*` | 0007, 0010 | `admissions.ts`, `website.ts` |
| C | `src/modules/finance`, pages `/finance`; later `src/app/(tenant)/[institution]/portal/**`, `e2e/**`, `scripts/load/**` | 0008 | `finance.ts` |
| D | `src/lib/ai/**`, `src/modules/ai`, `src/modules/jobs`, `src/modules/notifications`, `src/modules/academics/**/assignments*`, pages `/ai`, `/notifications`, `/jobs`, `/dashboard`, `/assignments`; `src/app/api/ai/**`, `src/app/api/jobs/**`, `scripts/ai-bench/**` | — | — |
| Lead | `src/lib/**` (except `ai`; T-007 and T-008 create their named `src/lib` files once, then lead-owned), `src/modules/core`, `src/modules/people` (schema), `src/modules/academics` (schema, queries), `supabase/**`, `scripts/seed/**` framework, `tests/helpers/**`, `.github/**` | 0001–0005 | `core.ts`, `people.ts`, `academics.ts` |

## 4. Shared-file conflict zones and rules

| Zone | Rule |
|---|---|
| Migration numbering | Reserved in `05 §7`; new fixes from `000012` reserved by the lead in `10-backlog-index.md` before work starts; never edit a merged file |
| `src/lib/auth/permissions.ts` | Lead-owned; lanes request additions in their packet's "permissions needed" list; the lead adds them before the lane starts (all demo permissions are already listed in `07 §2`) |
| Tenant layout and nav (`src/app/(tenant)/[institution]/layout.tsx`, `nav.ts`) | Lead-owned; nav items are declared in `src/lib/nav.ts` as data; lanes add one line each in their packet, merged by the lead |
| Seed script sections | One file per lane under `scripts/seed/sections/`; `index.ts` order owned by the lead; sections only read earlier sections' outputs via the `SeedContext` object |
| Generated `src/lib/db/types.ts` | Regenerated by whoever merges a migration; conflicts resolved by regenerating, never by hand-editing |
| Guardian portal page | Composes components exported by lane modules; the portal packet (T-034) owns the page, lanes own their components |
| `package.json` | New dependencies only via the lead; one-line justification required |

## 5. Likely delay causes and responses

| Cause | Early signal | Response |
|---|---|---|
| RLS helper or policy bugs blocking lanes | Checkpoint 1 generated suite red | Lead fixes before any lane starts; lanes continue on migrations only |
| Seed too slow or too big | `db:reset` > 3 min on Day 6 | Reduce attendance to 40 days; move attendance seed to a SQL function |
| AI SDK / Ollama provider API mismatch | Gateway tests fail Day 6 | Swap to `ollama-ai-provider-v2`; or temporarily use `generateObject`; never block other lanes |
| Next.js 16 conventions (proxy, async params, cache components) | Build warnings Day 1–2 | `T-001` records the installed version's conventions in `12-decision-log.md`; `cacheComponents: false` |
| Exam publish/recheck complexity | T-019/020 slipping past Day 12 | Lane C agent (free from Day 11) pairs on tests; recheck UI simplified (controller-only entry) |
| Review bottleneck on the lead | Packets waiting > half a day | Spawn `code-reviewer`/`security-reviewer` agents for non-security packets |
| Hosted Supabase differences (keys, extensions, auth settings) | Day 18 deploy errors | Day 18 is a full day; `11-operations.md` §4 checklist; Day 20 buffer |

## 6. Risk register (delivery)

| Risk | Likelihood | Impact | Owner | Mitigation |
|---|---|---|---|---|
| Foundation slips > 1 day | Medium | High | Lead | Checkpoint 1; lanes start on schema-only work |
| Cross-lane dependency (assignments → AI quiz; finance fn → enrolment) | Medium | Medium | Lead | Both scheduled with ≥ 1 day gap; interfaces fixed in `06` |
| Local model quality unacceptable | Medium | Medium | Lane D | Larger prompt scaffolding, lower question count, cloud optional, honest label |
| Laptop resource contention during demo | Medium | Medium | Lead | Demo on Vercel + hosted Supabase; Ollama shown separately |
| Data leak found Day 17 | Low | High | Lead | Generated suite runs from Day 4; fix before deploy |

## 7. Fallback ladder (apply in order; never removes security, audit, immutability, or honesty labels)

1. Drop T-040 AI benchmark (methodology stays documented).
2. Drop website editor UI (T-025); seed published pages; keep public site + enquiry.
3. Drop attendance corrections UI (keep marking + notification; corrections via SQL by admin, labeled limited).
4. Drop guardian-initiated recheck UI; exam controller records requests on behalf (labeled limited).
5. Replace dashboard charts with KPI tiles (keep live numbers).
6. Drop simulated email channel (keep in-app + simulated SMS).
7. Replace streaming AI with synchronous structured call (same gateway).
8. Reduce seed: 40 attendance days, 2 sections per grade visible in demo filters (data still seeded).
9. Drop assignments publish-to-guardian; quiz shown as teacher draft only (labeled limited).
10. Last: drop payment recording UI (seeded payments remain; receipts viewable), labeled limited.

## 8. Rehearsal plan (Day 19)

1. `pnpm demo:reset` on hosted (operator), confirm counts page.
2. Run the 13-step script (`11-operations.md` §10) with a stopwatch; target < 25 minutes with narration.
3. Note every moment that needed a technical explanation → fix copy/labels or cut from the script.
4. Repeat from reset; second run must be clean.
5. Record a screen capture as a backup for connectivity failure at the venue.

## 9. Checkpoint procedure (lead; same script every time)

1. Merge every packet that reports done and reviewed; regenerate `src/lib/db/types.ts` once.
2. `pnpm db:reset` (full seed) and record wall time.
3. `pnpm lint && pnpm typecheck && pnpm build`.
4. `pnpm test && pnpm test:db && pnpm test:security`.
5. `pnpm test:e2e` for the journeys available at that checkpoint (Day 4: J-00; Day 9: J-00, J-01, J-02, J-06; Day 13: all attempted; Day 16: all; Day 18: all on hosted).
6. Walk the clickable part of the narrative by hand with the named entities (`05 §8.1`).
7. Write `docs/archive/results/checkpoint-<day>.md`: suite counts, failures, decisions, debt added, packets re-planned.
8. Exit criteria per `08 §7`; a red checkpoint blocks new lane packets until green.

## 10. Lead operating rhythm (Days 2–14)

| Time | Activity |
|---|---|
| Start of day | Confirm deps merged for today's packets; reserve migration numbers / nav lines / permissions requested yesterday; assign packets with the packet file path and nothing else |
| Mid-day | Review window 1: security-sensitive packets first (`10 §4`); spawn `security-reviewer` for RLS/finance/exams/AI/seed packets, `code-reviewer` for the rest |
| End of day | Review window 2; merge; run targeted suites for merged packets; update `12 §3` debt and `10 §3` reservations; note slips against the critical path |
| Day 4, 9, 13, 16, 18 | Checkpoint procedure (§9) replaces lane work for the lead |
