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
    // The service-role client is allow-listed to these paths only (CLAUDE.md
    // rule 1, T-006). `src/lib/ai/**` added in T-035: `ai_usage_events` has
    // no INSERT policy and its SELECT policy excludes teachers, who still
    // hold `ai.generate` — see src/lib/supabase/admin.ts's "ai" caller.
    files: ["scripts/**", "src/modules/jobs/**", "src/lib/ai/**", "tests/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // T-024: the public enquiry route's own scoped helper and the route
    // that calls it — no other file under src/modules/website/** or
    // src/app/s/** may import the admin client (the renderer uses the anon
    // client only; RLS is its boundary, per the packet's security rules).
    files: ["src/modules/website/with-service-role.ts", "src/app/api/public/enquiry/route.ts"],
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
