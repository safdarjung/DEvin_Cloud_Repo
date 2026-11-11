// F18 §H — branding for the tenant layout: validated colour + the logo's public
// URL. The logo is public (bucket `school-branding`, 0127), so every role sees
// it with no signed URL and no service role. Anything invalid falls back to the default theme.
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { isHexColour, isLogoPathOf, LOGO_BUCKET } from "./branding-utils";

export interface LayoutBranding {
  primaryColor: string | null;
  logoUrl: string | null;
}

export async function getLayoutBranding(ctx: TenantContext): Promise<LayoutBranding> {
  const raw = ctx.institution.settings.branding as { logo_path?: unknown; primary_color?: unknown } | undefined;
  const primaryColor = typeof raw?.primary_color === "string" && isHexColour(raw.primary_color) ? raw.primary_color : null;
  const logoPath = typeof raw?.logo_path === "string" && isLogoPathOf(ctx.institution.id, raw.logo_path) ? raw.logo_path : null;
  if (!logoPath) return { primaryColor, logoUrl: null };
  // getPublicUrl only builds the URL; it makes no request.
  const { data } = (await createClient()).storage.from(LOGO_BUCKET).getPublicUrl(logoPath);
  return { primaryColor, logoUrl: data.publicUrl };
}
