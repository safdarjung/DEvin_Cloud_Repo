import Link from "next/link";
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
      <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-xl font-semibold">No institution assigned</h1>
        <p className="text-muted-foreground">Contact your administrator.</p>
      </main>
    );
  }

  if (institutions.length === 1) {
    redirect(`/${institutions[0].slug}`);
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">Choose an institution</h1>
      <ul className="flex flex-col gap-2">
        {institutions.map((inst) => (
          <li key={inst.slug}>
            <Link href={`/${inst.slug}`} className="underline">
              {inst.name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
