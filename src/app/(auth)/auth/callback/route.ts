import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Password-reset link target (PKCE). Redirects only to fixed internal paths.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/auth/reset-password", request.url));
    console.error(`/auth/callback: code exchange failed ${error.code ?? "unknown"}`);
  }
  return NextResponse.redirect(new URL("/auth/forgot-password?error=expired", request.url));
}
