import { ROLES, meta } from "@/components/marketing/content";
import { ButtonLink, CtaBand, PageHero, Section } from "@/components/marketing/ui";

export const metadata = meta("Roles", "What Principals, administrators, teachers, students and parents see in Fabric.", "/roles");

export default function Page() {
  return (
    <>
      <PageHero eyebrow="Roles" title="Each person sees their own part of the institution" lead="Access follows role. The same permission checks apply to the AI assistant." />
      <Section title="Who uses Fabric">
        <div className="divide-y divide-(color:--mk-line) border-y border-(color:--mk-line)">
          {ROLES.map((r) => (
            <article key={r.role} className="grid gap-3 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
              <div>
                <h3 className="font-semibold">{r.role}</h3>
                <p className="text-(color:--mk-muted)">{r.summary}</p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-(color:--mk-muted)">
                {r.sees.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </article>
          ))}
        </div>
        <div className="mt-8"><ButtonLink href="/demo" arrow>Try a role in the demo</ButtonLink></div>
      </Section>
      <CtaBand />
    </>
  );
}
