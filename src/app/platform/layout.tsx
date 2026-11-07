import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { BarChart3, Building2, CreditCard, LayoutDashboard, Receipt, Settings } from "lucide-react";
import { MobileNav, SIDEBAR_COOKIE, TenantSidebar, type NavLinkItem, type SidebarUser } from "@/components/tenant/sidebar";
import { createClient, getClaims } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Platform console", robots: { index: false, follow: false } };

const icon = "size-[18px]";
const NAV: NavLinkItem[] = [
  { href: "/platform", label: "Overview", icon: <LayoutDashboard className={icon} aria-hidden />, group: "Platform" },
  { href: "/platform/institutions", label: "Institutions", icon: <Building2 className={icon} aria-hidden />, group: "Platform" },
  { href: "/platform/subscriptions", label: "Subscriptions", icon: <CreditCard className={icon} aria-hidden />, group: "Platform" },
  { href: "/platform/billing", label: "Billing", icon: <Receipt className={icon} aria-hidden />, group: "Platform" },
  { href: "/platform/usage", label: "Usage", icon: <BarChart3 className={icon} aria-hidden />, group: "Platform" },
  { href: "/platform/settings", label: "Settings", icon: <Settings className={icon} aria-hidden />, group: "Administration" },
];

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const claims = await getClaims();
  if (!claims) redirect("/login");

  // Own profile row through the normal RLS client; no service role.
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("full_name, is_platform_admin").eq("id", claims.sub).maybeSingle();
  // Non-admins get a plain 404 so the console's existence is never revealed.
  if (!profile?.is_platform_admin) notFound();

  const user: SidebarUser = { name: profile.full_name?.trim() || "Platform owner", roleLabel: "Platform owner", institutionName: "Platform console" };
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--z-toast) focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="flex flex-1">
        <Suspense>
          <TenantSidebar items={NAV} user={user} defaultCollapsed={collapsed} />
        </Suspense>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-(--z-header) flex h-14 items-center gap-3 border-b border-topbar-border bg-topbar px-3 sm:px-4 lg:px-6">
            <Suspense>
              <MobileNav items={NAV} user={user} />
            </Suspense>
            <span className="text-sm font-semibold">Platform console</span>
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Platform owner</span>
          </header>
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 pb-8 outline-none sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
