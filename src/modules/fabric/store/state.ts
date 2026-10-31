// F-BE-04 — Fabric demo store state shape. Phase 1 (fixtures, localStorage);
// Phase 2 swaps `use-demo-store.ts` for real tables without touching the
// rows themselves (src/modules/fabric/types.ts is the contract, unchanged).
import type {
  InsightAction,
  InsightStatus,
  InterventionPlan,
  ModuleInstall,
  PersonalGoal,
  PersonalMemory,
  Scenario,
  StudioProposal,
  StudioRequest,
  Workflow,
} from "@/modules/fabric/types";

export const DEMO_STATE_VERSION = 1;

export interface DemoState {
  version: 1;
  hydrated: boolean;
  layouts: Record<string, string[]>;
  installs: ModuleInstall[];
  scenarios: Scenario[];
  requests: StudioRequest[];
  proposals: StudioProposal[];
  workflows: Workflow[];
  memories: PersonalMemory[];
  goals: PersonalGoal[];
  interventions: InterventionPlan[];
  insightStatus: Record<string, InsightStatus>;
  insightActions: InsightAction[];
  notes: Record<string, string>;
}

/**
 * Builds a fresh state. `seedData` injects fixture-derived rows (fixtures
 * land in a parallel packet — this module never imports them); omitted
 * collections default empty. `version`/`hydrated` are never taken from
 * `seedData` — they are owned by the store.
 */
export function initialState(seedData?: Partial<DemoState>): DemoState {
  return {
    version: DEMO_STATE_VERSION,
    hydrated: false,
    layouts: seedData?.layouts ?? {},
    installs: seedData?.installs ?? [],
    scenarios: seedData?.scenarios ?? [],
    requests: seedData?.requests ?? [],
    proposals: seedData?.proposals ?? [],
    workflows: seedData?.workflows ?? [],
    memories: seedData?.memories ?? [],
    goals: seedData?.goals ?? [],
    interventions: seedData?.interventions ?? [],
    insightStatus: seedData?.insightStatus ?? {},
    insightActions: seedData?.insightActions ?? [],
    notes: seedData?.notes ?? {},
  };
}
