"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { initDemoStore, type DemoState } from "@/modules/fabric/store";

export type FabricSeed = Partial<DemoState>;

const SeedContext = createContext<FabricSeed>({});

/** Reset needs the fixture-derived defaults again, so the seed is shared via context. */
export const useFabricSeed = (): FabricSeed => useContext(SeedContext);

/**
 * Seeds the demo store once per page tree, in render (not an effect): children
 * read the store during hydration and their server-rendered markup must match.
 */
export function FabricProvider({ seed, children }: { seed: FabricSeed; children: ReactNode }) {
  useState(() => initDemoStore(seed));
  return <SeedContext.Provider value={seed}>{children}</SeedContext.Provider>;
}
