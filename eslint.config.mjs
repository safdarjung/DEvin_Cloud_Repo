import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message:
                "The service-role client is allow-listed to seed/reset, the job runner, and security-definer callers only (CLAUDE.md rule 1; finalised in T-006). Use @/lib/supabase/server or @/lib/supabase/client instead.",
            },
          ],
        },
      ],
    },
  },
  {
    // The service-role client is allow-listed to these paths only (CLAUDE.md rule 1, T-006).
    files: ["scripts/**", "src/modules/jobs/**", "tests/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
