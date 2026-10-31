import { defaultWidgetOrder } from "@/modules/fabric/demo/command";
import { interventionPlans } from "@/modules/fabric/demo/success";
import { initialInstalls } from "@/modules/fabric/demo/marketplace";
import { personalGoals, personalMemories } from "@/modules/fabric/demo/personal";
import { scenarios } from "@/modules/fabric/demo/simulator";
import { studioProposals, studioRequests } from "@/modules/fabric/demo/studio";
import { workflows } from "@/modules/fabric/demo/agents";
import type { FixtureOpts } from "@/modules/fabric/demo/prng";
import type { DemoState } from "@/modules/fabric/store";

const ROLES = ["principal", "teacher", "guardian", "student"] as const;

/** Fixture-derived starting state for the demo store (server-side, deterministic). */
export function fabricSeed(opts: FixtureOpts, userId: string): Partial<DemoState> {
  return {
    layouts: Object.fromEntries(ROLES.map((r) => [r, defaultWidgetOrder(r)])),
    installs: initialInstalls(opts),
    scenarios: scenarios(opts),
    requests: studioRequests(opts),
    proposals: studioProposals(opts),
    workflows: workflows(opts),
    memories: personalMemories(opts, userId),
    goals: personalGoals(opts, userId),
    interventions: interventionPlans(opts),
  };
}
