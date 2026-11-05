Packet: M24-T3 Extract the D28/D29 cloud stream from the teacher route
Files changed: src/modules/ai/agent/cloud-stream.ts (new); src/app/api/ai/agent/teacher/route.ts (edit); tests/unit/cloud-stream.test.ts (new)
Behavior: streamCloudAgent(input) = checkLimits -> concurrency slot -> model
factory (groq/gemini) -> streamText(stepCountIs(6), maxOutputTokens 1024,
toolCallConcurrency 1) -> usage logging (onStepFinish accumulation +
redactions) -> slot release, moved verbatim from teacher route. Route now:
gates -> teacherTools + convertToModelMessages -> streamCloudAgent ->
map {ok:false} to existing json(fail(...)); responses byte-identical.
Tests run: pnpm typecheck -> clean. pnpm lint -> 0 errors (8 warnings,
unrelated file). pnpm test (cloud-stream/teacher-agent-route) -> vitest
crashes at startup (vite module-runner "code.charCodeAt is not a function"
via postgres), same pre-existing env break as T1/T2 reports; reproduced
identically on unedited teacher-agent-route.test.ts, not caused by this change.
Tests not run and why: all vitest runs, broken runner (above). No DB stack
in this lane.
Limitations / honesty label: n/a, no UI surface.
Security/integration risks: none beyond original code; logic moved only.
Follow-ups: fix vitest runner (pre-existing, lane-wide) before any unit
suite can run.
New dependencies: none.
Assumptions: CloudAgentInput.messages is ModelMessage[] (route keeps
convertToModelMessages); modelId/getModel resolution moved into
cloud-stream.ts since CloudAgentInput carries only `provider`, matching
the EXPORTS spec and needed for its own checkLimits-failure logUsage call.
