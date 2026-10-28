# 02 — Environment baseline

Facts established before this planning run (prompt §0), plus what remains unverified. This page is the only home for environment facts; other docs link here.

## 1. Repository

| Item | State |
|---|---|
| Path | `/home/safdar/Desktop/projects/coolschool` |
| Contents at planning time | `README.md`, `.gitignore`, `docs/planning/coolskool/00-planning-prompt.md` |
| Application code | None. Greenfield. No related project exists on this machine. |
| Git | Initialised on `main`; remote `origin = https://github.com/schoolversee/schoolverse` |
| Credentials | Global git credential store. Never ask for, print, or store a token. `gh` CLI is **not** installed. |
| Commit convention | Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `perf:`, `ci:`) |

## 2. Toolchain (verified by the user before this run)

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.19 | Meets the Next.js minimum. |
| pnpm | 11.10 | Package manager (ADR D2). |
| Docker | 29 | Runs local Supabase. |
| Vercel CLI | 48 | Deployment on Day 18 only. |
| Ollama | 0.15.2 | Local inference path. |
| GPU | NVIDIA RTX 4050 Laptop, 6 GB VRAM | Constrains local model choice (`12-decision-log.md` Phase 0 facts). |
| Playwright | Chromium already cached | E2E. |
| Supabase CLI | **Not installed** | Add as a pnpm dev dependency (`supabase`), the official method. |

## 3. Supabase account

- Organization exists. **No CoolSkool project exists.**
- Development: local Supabase via Docker (`pnpm db:start`).
- Hosted project: created by the user when deployment is needed (Day 18), region `ap-south-1` (Mumbai). See `11-operations.md` §4.

## 4. Credentials and keys — current state

| Credential | Exists | Design consequence |
|---|---|---|
| Anthropic API key | No | Cloud AI is optional; gateway runs `local_only` by default. |
| OpenAI / Google AI keys | No | Not used. |
| Google OAuth client | No | Google sign-in documented only (`11-operations.md` §7); demo uses seeded email/password logins. |
| SMS provider | No | Simulated adapter, labeled in UI. |
| Email provider | No | Simulated adapter, labeled in UI. |
| Payment gateway | No | Offline payment recording only. |
| Vercel project | No | Created on Day 18. |

## 5. Laptop as the dev + demo host

Docker (Supabase ≈ 2–3 GB RAM), the Next.js dev server, and Ollama share one laptop. VRAM is used by Ollama only; CPU RAM is shared. The AI benchmark (`T-040`) records this contention explicitly. The demo itself runs from Vercel + hosted Supabase; local Ollama is shown from the laptop as the "institution-controlled inference" path.

## 6. Unverified (to be confirmed by the first implementation packets)

- Exact current versions of all npm packages at install time (Phase 0 agents checked docs; `T-001`/`T-002` pin them in `package.json` and record them in `12-decision-log.md`).
- The request interceptor is `proxy.ts` per the Next 16 docs (D24); `T-006` confirms it against the installed version.
- Which Ollama model gives acceptable JSON validity on this GPU (`T-040` measures; nothing is asserted before then).
- Local Supabase default ports and the new publishable/secret key naming in the installed CLI (`T-002` records).
- Hosted Supabase project availability in `ap-south-1` at deploy time.

## 7. Boundaries of this planning run

No application code, no dependency installs, no migrations, no Supabase project, no deployment, no destructive commands, no secrets. Nothing here has been tested, benchmarked, or load-tested.
