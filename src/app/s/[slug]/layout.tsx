import { notFound } from "next/navigation";
import { parseNavSafely } from "@/modules/website/blocks";
import { getPublicSite } from "@/modules/website/queries";

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

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <a href={`/s/${slug}`} className="font-semibold">
            {site.institutionName}
          </a>
          {nav.length > 0 && (
            <nav className="flex gap-4 text-sm">
              {nav.map((item) => (
                <a key={item.path} href={item.path.startsWith("/") ? `/s/${slug}${item.path === "/" ? "" : item.path}` : item.path}>
                  {item.label}
                </a>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4">{children}</main>
      <footer className="text-muted-foreground border-t py-6 text-center text-xs">
        &copy; {new Date().getFullYear()} {site.institutionName}
      </footer>
    </div>
  );
}
