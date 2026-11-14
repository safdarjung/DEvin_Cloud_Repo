// Counts quoted on the landing page, the deck and the film. Plain constants because the film render
// script loads this under plain node (no "@/" alias); tests/unit/home-story.test.ts pins each one to
// its real source so a new module, role or AI capability fails the test until this file is updated.
export const HOME_STATS = {
  /** Object.keys(MODULES).length in src/lib/modules/catalog.ts */
  modules: 62,
  /** Distinct ModuleCategory values in use */
  categories: 11,
  /** ROLES in src/lib/auth/permissions.ts */
  roles: 9,
  /** CAPABILITY_KEYS.length in src/modules/ai/capabilities/catalog.ts */
  aiSkills: 92,
  /** STUDENT_LANGUAGES.length in src/modules/ai/prompts/student-skills.ts (includes English and Hinglish) */
  studyLanguages: 12,
} as const;
