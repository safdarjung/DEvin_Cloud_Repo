import { z } from "zod";
import { PRACTICE_SCENARIO_KEYS } from "./scenarios";

export const RunPracticeScenarioSchema = z.object({ scenario: z.enum(PRACTICE_SCENARIO_KEYS) }).strict();
export type RunPracticeScenarioInput = z.infer<typeof RunPracticeScenarioSchema>;
