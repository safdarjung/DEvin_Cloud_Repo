// F-BE-04 — Fabric demo store public API.
export type { DemoState } from "./state";
export { DEMO_STATE_VERSION, initialState } from "./state";
export type { DemoIntent } from "./reducer";
export { reduce } from "./reducer";
export { DemoStateSchema } from "./schema";
export type { DemoStateInput } from "./schema";
export { STORAGE_KEY, loadState, saveState, exportJson, parseImport } from "./persist";
export type { ParseImportResult } from "./persist";
export { useDemoStore, dispatch, initDemoStore, getState } from "./use-demo-store";
