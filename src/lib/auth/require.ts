import { AppError } from "@/lib/actions/result";
import { hasPermission as roleHasPermission, type Permission } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";

export function hasPermission(ctx: TenantContext, permission: Permission): boolean {
  return roleHasPermission(ctx.membership.role, permission);
}

export function requirePermission(ctx: TenantContext, permission: Permission): void {
  if (!hasPermission(ctx, permission)) {
    throw new AppError("forbidden", "You do not have permission to perform this action.");
  }
}
