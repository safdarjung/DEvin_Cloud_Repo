---
name: coolskool-project
description: "CoolSkool school OS project facts — greenfield repo, GitHub remote, planning package status, 20-day demo target"
metadata:
  node_type: memory
  type: project
  originSessionId: 389f81ff-0381-4199-9607-cbb7bd4a769d
  modified: 2026-10-29T09:44:36.458Z
---

CoolSkool is an AI-powered school operating system for Tier 2/3 Indian private schools (target 100 teachers / 3,000 students). Greenfield repo at /home/safdar/Desktop/projects/coolschool, remote https://github.com/schoolversee/schoolverse (branch main). GitHub auth is in the global git credential store; never write tokens into the repo.

Status 2026-10-28: the planning package (docs/planning/coolskool/00-README.md index, docs 01–12, tasks/T-001…T-045, root CLAUDE.md) was written by a Fable 5.1 run (commit 883d9c7) and refined on 2026-10-29 (demo-data contract in 05 §8.1, full workflow template, ADRs D1–D25); both pushed to origin/main. Implementation started 2026-10-29 (Opus lead dispatching Sonnet subagents per packet): Work lives on branch `feat/mvp-implementation` (not main; nothing pushed). On 2026-10-29 the owner said "continue, whatever approach best": the lead commits each packet on that branch once tests + required review pass. Push or merge to main still needs explicit approval. Check `git log`/`git status` for the current state rather than trusting this line.

20-day demo deadline runs from the first implementation day (demo target mid-to-late November 2026). No API keys or hosted Supabase project exist yet; local Supabase via Docker and Ollama on an RTX 4050 (desktop already uses ~2.9 GB of its 6 GB VRAM) are the dev paths. See [[feedback-act-dont-probe]].
