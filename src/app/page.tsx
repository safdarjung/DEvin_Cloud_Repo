import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { createClient, getClaims } from "@/lib/supabase/server";

export default async function Home() {
  const claims = await getClaims();
  if (!claims) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("memberships")
    .select("institutions(slug, name)")
    .eq("user_id", claims.sub)
    .eq("status", "active");

  const institutions = (memberships ?? [])
    .map((m) => m.institutions)
    .filter((inst): inst is { slug: string; name: string } => inst !== null);

  if (institutions.length === 0) {
    return (
      <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-muted/30 p-6">
        <div className="w-full max-w-md bg-card">
          <EmptyState title="No institution assigned" description="Your account isn't linked to a school yet. Contact your administrator." />
        </div>
      </main>
    );
  }

  if (institutions.length === 1) {
    redirect(`/${institutions[0].slug}`);
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose an institution</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {institutions.map((inst) => (
              <li key={inst.slug}>
                <Link
                  href={`/${inst.slug}`}
                  className="flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {inst.name}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
