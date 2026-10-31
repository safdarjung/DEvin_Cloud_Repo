// F-BE-04 — pure reducer for the Fabric demo store. Never mutates `state`
// (always spread/map/filter); returns the SAME reference when an intent has
// no effect (missing id, identical value) so useSyncExternalStore selectors
// can skip a re-render.
import type {
  Id,
  InsightAction,
  InsightStatus,
  InterventionPlan,
  ModuleInstall,
  ModuleInstallStatus,
  PersonalGoal,
  PersonalMemory,
  Scenario,
  StudioProposal,
  StudioRequest,
  StudioStatus,
  Workflow,
} from "@/modules/fabric/types";
import type { DemoState } from "./state";
import { initialState } from "./state";

export type DemoIntent =
  | { type: "setLayout"; key: string; order: string[] }
  | { type: "installModule"; install: ModuleInstall }
  | { type: "uninstallModule"; id: Id }
  | { type: "setInstallStatus"; id: Id; status: ModuleInstallStatus }
  | { type: "saveScenario"; scenario: Scenario }
  | { type: "deleteScenario"; id: Id }
  | { type: "submitRequest"; request: StudioRequest }
  | { type: "setRequestStatus"; id: Id; status: StudioStatus }
  | { type: "saveProposal"; proposal: StudioProposal }
  | { type: "advancePipeline"; request_id: Id }
  | { type: "saveWorkflow"; workflow: Workflow }
  | { type: "setWorkflowStatus"; id: Id; status: Workflow["status"] }
  | { type: "upsertMemory"; memory: PersonalMemory }
  | { type: "deleteMemory"; id: Id }
  | { type: "upsertGoal"; goal: PersonalGoal }
  | { type: "toggleTask"; goal_id: Id; task_id: Id }
  | { type: "saveIntervention"; intervention: InterventionPlan }
  | { type: "setInsightStatus"; insight_id: Id; status: InsightStatus }
  | { type: "recordInsightAction"; action: InsightAction }
  | { type: "measureOutcome"; action_id: Id; actual_outcome: string }
  | { type: "setNote"; key: string; text: string }
  | { type: "importState"; state: DemoState }
  | { type: "reset"; seedData?: Partial<DemoState> };

function upsertById<T extends { id: Id }>(list: T[], item: T): T[] {
  const index = list.findIndex((row) => row.id === item.id);
  if (index === -1) return [...list, item];
  return list.map((row, i) => (i === index ? item : row));
}

function removeById<T extends { id: Id }>(list: T[], id: Id): T[] {
  if (!list.some((row) => row.id === id)) return list;
  return list.filter((row) => row.id !== id);
}

export function reduce(state: DemoState, intent: DemoIntent): DemoState {
  switch (intent.type) {
    case "setLayout":
      return { ...state, layouts: { ...state.layouts, [intent.key]: intent.order } };

    case "installModule":
      return { ...state, installs: upsertById(state.installs, intent.install) };

    case "uninstallModule": {
      const installs = removeById(state.installs, intent.id);
      return installs === state.installs ? state : { ...state, installs };
    }

    case "setInstallStatus": {
      const index = state.installs.findIndex((row) => row.id === intent.id);
      if (index === -1 || state.installs[index].status === intent.status) return state;
      return {
        ...state,
        installs: state.installs.map((row, i) => (i === index ? { ...row, status: intent.status } : row)),
      };
    }

    case "saveScenario":
      return { ...state, scenarios: upsertById(state.scenarios, intent.scenario) };

    case "deleteScenario": {
      const scenarios = removeById(state.scenarios, intent.id);
      return scenarios === state.scenarios ? state : { ...state, scenarios };
    }

    case "submitRequest":
      return { ...state, requests: upsertById(state.requests, intent.request) };

    case "setRequestStatus": {
      const index = state.requests.findIndex((row) => row.id === intent.id);
      if (index === -1 || state.requests[index].status === intent.status) return state;
      return {
        ...state,
        requests: state.requests.map((row, i) => (i === index ? { ...row, status: intent.status } : row)),
      };
    }

    case "saveProposal":
      return { ...state, proposals: upsertById(state.proposals, intent.proposal) };

    case "advancePipeline": {
      const candidates = state.proposals.filter((p) => p.request_id === intent.request_id);
      if (candidates.length === 0) return state;
      const proposal = candidates.reduce((latest, p) => (p.version > latest.version ? p : latest));
      const runningIndex = proposal.pipeline.findIndex((s) => s.status === "running");
      let pipeline = proposal.pipeline;
      if (runningIndex !== -1) {
        pipeline = pipeline.map((s, i) => (i === runningIndex ? { ...s, status: "done" as const } : s));
        const nextIndex = pipeline.findIndex((s) => s.status === "pending");
        if (nextIndex !== -1) {
          pipeline = pipeline.map((s, i) => (i === nextIndex ? { ...s, status: "running" as const } : s));
        }
      } else {
        const firstPending = pipeline.findIndex((s) => s.status === "pending");
        if (firstPending === -1) return state;
        pipeline = pipeline.map((s, i) => (i === firstPending ? { ...s, status: "running" as const } : s));
      }
      return { ...state, proposals: upsertById(state.proposals, { ...proposal, pipeline }) };
    }

    case "saveWorkflow":
      return { ...state, workflows: upsertById(state.workflows, intent.workflow) };

    case "setWorkflowStatus": {
      const index = state.workflows.findIndex((row) => row.id === intent.id);
      if (index === -1 || state.workflows[index].status === intent.status) return state;
      return {
        ...state,
        workflows: state.workflows.map((row, i) => (i === index ? { ...row, status: intent.status } : row)),
      };
    }

    case "upsertMemory":
      return { ...state, memories: upsertById(state.memories, intent.memory) };

    case "deleteMemory": {
      const memories = removeById(state.memories, intent.id);
      return memories === state.memories ? state : { ...state, memories };
    }

    case "upsertGoal":
      return { ...state, goals: upsertById(state.goals, intent.goal) };

    case "toggleTask": {
      const goalIndex = state.goals.findIndex((g) => g.id === intent.goal_id);
      if (goalIndex === -1) return state;
      const goal = state.goals[goalIndex];
      const taskIndex = goal.tasks.findIndex((t) => t.id === intent.task_id);
      if (taskIndex === -1) return state;
      const tasks = goal.tasks.map((t, i) => (i === taskIndex ? { ...t, done: !t.done } : t));
      return {
        ...state,
        goals: state.goals.map((g, i) => (i === goalIndex ? { ...g, tasks } : g)),
      };
    }

    case "saveIntervention":
      return { ...state, interventions: upsertById(state.interventions, intent.intervention) };

    case "setInsightStatus": {
      if (state.insightStatus[intent.insight_id] === intent.status) return state;
      return { ...state, insightStatus: { ...state.insightStatus, [intent.insight_id]: intent.status } };
    }

    case "recordInsightAction":
      return { ...state, insightActions: upsertById(state.insightActions, intent.action) };

    case "measureOutcome": {
      const index = state.insightActions.findIndex((row) => row.id === intent.action_id);
      if (index === -1) return state;
      const measuredAt = new Date().toISOString();
      return {
        ...state,
        insightActions: state.insightActions.map((row, i) =>
          i === index
            ? { ...row, actual_outcome: intent.actual_outcome, status: "measured" as const, measured_at: measuredAt }
            : row,
        ),
      };
    }

    case "setNote": {
      if (state.notes[intent.key] === intent.text) return state;
      return { ...state, notes: { ...state.notes, [intent.key]: intent.text } };
    }

    case "importState":
      return intent.state;

    case "reset":
      return initialState(intent.seedData);

    default:
      return state;
  }
}
