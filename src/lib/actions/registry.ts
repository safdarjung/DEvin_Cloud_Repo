// Every action defineAction() creates registers itself here by name so the
// C-03 escalation suite can call every action as every role (06 §1.2).
export type AnyAction = (institutionSlug: string, raw: unknown) => Promise<unknown>;

const registry = new Map<string, AnyAction>();

export function registerAction(name: string, action: AnyAction): void {
  if (registry.has(name)) {
    throw new Error(`Action "${name}" is already registered.`);
  }
  registry.set(name, action);
}

export function getRegisteredActions(): ReadonlyMap<string, AnyAction> {
  return registry;
}
