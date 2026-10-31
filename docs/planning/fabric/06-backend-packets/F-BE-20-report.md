Packet: F-BE-20 React Flow wrapper
Dep: @xyflow/react@12.12.0 (-E), peer react 19.3.0/react-dom 19.3.0 ok, @xyflow/system@0.0.83 transitive.
Files: src/lib/genui/flow-from-spec.ts, src/lib/genui/flow-canvas.tsx, tests/unit/flow-from-spec.test.ts, package.json, pnpm-lock.yaml.
Behavior: flowFromSpec = pure spec→RF nodes/edges mapper; missing x/y gets BFS-longest-path depth column (220px) + input-order row (90px), self-loops excluded from depth calc, cycle leftovers appended in input order. FlowCanvas = "use client" ReactFlow wrapper, useNodesState/useEdgesState, fitView, MiniMap/Controls/Background, pan+zoom on, drag gated on !readOnly, theme vars (--xy-*) mapped from globals.css tokens, style.css imported once here.
canvas-renderer.tsx: not present yet (no F-BE-03 placeholder found in src/). Left wiring to owner, per packet fallback.
Tests: pnpm vitest run --project unit tests/unit/flow-from-spec.test.ts → 4/4 pass.
Not run: pnpm test (full unit suite has pre-existing unrelated failures in tests/unit/nav.test.ts from concurrent nav-fabric work, untouched by this packet) and pnpm typecheck (pre-existing errors in src/app/(tenant)/[institution]/fabric/* and other in-flight packets' files, not mine) — both ignored per BRIEF-COMMON rule 6.
Lint: pnpm lint clean on my 2 files; 1 pre-existing error in src/modules/fabric/router/use-visual-route.ts (not mine).
Honesty label: N/A, no UI badge surface here.
Risks: FlowCanvas untested in a real page (no consumer wired yet); NodeTypes/custom node styling left to caller.
Follow-ups: F-BE-03 (or whoever owns canvas-renderer.tsx) wires next/dynamic(() => import("./flow-canvas")) + flowFromSpec.
Assumptions: node.type passed through 1:1 as RF node type (custom nodeTypes key); edge id = `${source}->${target}-${index}` to avoid dup-pair collisions.
