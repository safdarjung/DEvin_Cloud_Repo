Packet: M22-T11 Acceptance over HTTP
Files changed: tests/db/agents-acceptance.test.ts (new)
Behavior implemented: one HTTP-only test (route+bearer pattern from timetable-acceptance.test.ts) mocking only providers.getLocalModel with ai/test's MockLanguageModelV4 (streamAgent/executor/registry all real). Script: finance_listDefaulters + exams_listExams (unregistered) + propose_finance_reminders_send, then final text. Asserts: agents off -> owner agent.run 403; on -> 200 awaiting_approval/human_approved, log has "Called finance.listDefaulters" + "Unknown tool exams_listExams", no jobs row yet; admin agent.approve 403; principal agent.approve 200 done + 1 public.jobs row (finance.fee_reminder); second approve 4xx; teacher agent.run 403; GET agents.runs shows approver "Principal Priya" + cost_paise 0; ai_usage_events row (agent_run_id=runId, feature agent.finance) found via short poll (logUsage fires off stream.totalUsage, not awaited by executeAgentRun); GET ai.usageSummary totalRequests >= 1.
Tests run: pnpm test:db tests/db/agents-acceptance.test.ts -> 1/1 pass. pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run and why: full test:db (brief: own file only, no --).
Limitations / honesty label: none (T12 records the LimitedBadge).
Security / integration risks: none new, read/assert-only test; exercises existing T1/T2/T5-T10 paths, no production code touched.
Follow-ups: none for T11. T12 can cite this file as the HTTP-level proof for its docs updates.
New dependencies (justification): none.
Assumptions made: module-off/on toggled with jsonb_set on settings.modules.agents only (not the wider settings||'{"modules":{...}}' merge T7's own test used, which replaces the whole modules object); principal (not the owner requester) approves, matching the brief's "principal (or owner, whichever holds the action's permission)" wording; profiles.full_name set by SQL first since fixture users carry no raw_user_meta_data (same as T9's own test).
