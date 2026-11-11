import { notFound } from "next/navigation";
import { parseNavSafely } from "@/modules/website/blocks";
import { getPublicSite } from "@/modules/website/queries";
import { parseThemeSafely, THEMED_SITE_CLASS, websiteThemeStyle } from "@/modules/website/theme";

// 04 §6 — the public site shell. 404 for an unknown slug or an offline
// site (06 §W3) without revealing which case it is.
export default async function PublicSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await getPublicSite(slug);
  if (!site) notFound();

  const nav = parseNavSafely(site.nav);
  // Re-validated on every read: a stored theme that does not parse renders the default look.
  const theme = parseThemeSafely(site.theme);

  return (
    <div className={`flex min-h-screen flex-col ${THEMED_SITE_CLASS}`} style={websiteThemeStyle(theme)} data-hero={theme.heroStyle}>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <a href={`/s/${slug}`} className="text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {site.institutionName}
          </a>
          {nav.length > 0 && (
            <nav aria-label="Main" className="-mx-1 flex flex-wrap gap-x-1 text-sm">
              {nav.map((item) => (
                <a
                  key={item.path}
                  href={item.path.startsWith("/") ? `/s/${slug}${item.path === "/" ? "" : item.path}` : item.path}
                  className="rounded-md px-2 py-2 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main id="content" className="mx-auto w-full max-w-5xl flex-1 px-4">
        {children}
      </main>
      <footer className="border-t bg-card py-6 text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} {site.institutionName}
      </footer>
    </div>
  );
}
