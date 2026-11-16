import type { Permission, Role } from "@/lib/auth/permissions";

// 04 §4 — resolved once per request by getTenantContext (T-007), recomputed
// inside every server action by defineAction. Never trust a client-supplied
// institution_id; this is the only source of truth for the current request.
export interface TenantContext {
  institution: {
    id: string;
    slug: string;
    name: string;
    settings: Record<string, unknown>;
    ai_policy: "local_only" | "cloud_allowed" | "local_with_cloud_fallback";
    is_demo: boolean;
    /** ISO timestamp; drives the free-trial banner. Optional so test fixtures need not set it. */
    created_at?: string;
  };
  user: {
    id: string;
    profile: {
      fullName: string | null;
      phone: string | null;
      avatarPath: string | null;
      isPlatformAdmin: boolean;
    };
  };
  membership: {
    role: Role;
    staffId: string | null;
    guardianId: string | null;
    studentId: string | null;
  };
  permissions: Set<Permission>;
}
