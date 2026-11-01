---
name: feedback-skills-and-voice
description: "Owner expects ponytail, karpathy-guidelines, Context7, superpowers and caveman used explicitly; terse plain-English voice everywhere, no caveman dialect"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 389f81ff-0381-4199-9607-cbb7bd4a769d
  modified: 2026-10-30T11:15:45.048Z
---

Owner (2026-10-29) expects these used visibly on every packet: ponytail, `andrej-karpathy-skills:karpathy-guidelines`, Context7 (via the `docs-lookup` agent, which has the context7 tools), superpowers skills, and caveman. Communication: compressed caveman style everywhere (chat, agent prompts, agent reports) but plain grammar — no "me think" dialect.

**Why:** owner asked "you are using ponytail, karpathy, context7, superpowers right?" and the honest answer was only partly — skills were named in briefs but not invoked via the Skill tool, and Context7 use was never verified.

**Finding 2026-10-29:** the `docs-lookup` agent could not reach Context7 in this environment (answered from training data); agents fell back to installed `.d.ts`, `node_modules/next/dist/docs`, and WebFetch of vendor docs. Tell the owner if Context7 is required — it needs fixing at the MCP/config level.

**How to apply:** lead invokes karpathy-guidelines and the relevant superpowers skill (e.g. dispatching-parallel-agents, verification-before-completion) via Skill before each batch; every implementation brief requires library-API checks through `docs-lookup` and a line in the report saying what Context7 confirmed; briefs and reports stay terse plain English. See [[agent-briefing-lessons]].

**Reinforced 2026-10-30:** owner asked again to always use ponytail/karpathy/Context7/caveman, then to make it the project default — codified in CoolSkool's `CLAUDE.md` (new "Default skills and voice" section near the top). Apply this standing preference in every session on this project, not just when reminded, and to any future project this owner starts.
