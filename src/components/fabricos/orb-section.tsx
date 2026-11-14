// The Orb: each person's AI assistant. A live copy of the app's own sphere to spin and poke, what
// it does, then the ask demo (scripted with sample data and labelled so) showing drawn answers.
import Link from "next/link";
import { ArrowRight, CircleDot, Mic, PenLine, Users } from "lucide-react";
import { AskDemo } from "@/components/home/sections/AskDemo";
import { HOME_STATS } from "@/components/home/stats";
import { BRAND, CTA } from "./content";
import { FabricGlyph } from "./fabric-glyph";
import { LiveOrb } from "./live-orb";
import { ScrollReveal } from "./scroll-reveal";
import { SectionShell } from "./section-shell";
import "./ask-demo.css";

const id = "orb";

const FACTS = [
  { icon: Users, title: "One orb per person", body: "Principal, office, teacher, student and parent each get their own, holding only what their role may do." },
  { icon: CircleDot, title: "Every dot is a skill", body: `${HOME_STATS.aiSkills} skills in all. Click a dot to run it, or just ask.` },
  { icon: Mic, title: "Type it or say it", body: "Ask in plain words. Voice uses your browser's speech recognition." },
  { icon: PenLine, title: "It draws, you decide", body: "Answers come back as charts, mind maps and hints. Anything that would change a record comes back as a card that waits for your approval." },
] as const;

export function OrbSection() {
  return (
    <SectionShell id={id} className="border-t border-(color:--fos-line) bg-[radial-gradient(60%_50%_at_22%_24%,rgb(75_82_200_/_0.2),transparent_70%)]">
      <ScrollReveal>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div className="mx-auto w-full max-w-[27rem]" data-reveal>
            <LiveOrb
              className="aspect-square w-full cursor-grab touch-pan-y select-none active:cursor-grabbing"
              freq={4}
              share={0.4}
              query="(prefers-reduced-motion: no-preference)"
              reach="self"
              fallback={<FabricGlyph className="size-full p-[10%] text-(color:--fos-fg)" />}
            />
            <p className="fos-tag mt-2 justify-center motion-reduce:hidden">Spin it. Poke it. It is the same orb as in the app.</p>
          </div>
          <div>
            <p className="fos-eyebrow" data-reveal>
              The Orb
            </p>
            <h2 id={`${id}-title`} className="fos-h2 mt-5" data-reveal>
              Meet the Orb. Ask it anything you are allowed to know.
            </h2>
            <p className="fos-lead mt-6" data-reveal>
              The Orb is the AI assistant inside {BRAND}: one sphere that holds everything the system can do for you. It reads only what your role may see.
            </p>
            <ul className="mt-10 grid gap-x-10 gap-y-7 sm:grid-cols-2">
              {FACTS.map((f) => (
                <li key={f.title} className="flex gap-3.5" data-reveal>
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg border border-(color:--fos-line-strong) text-(color:--fos-cyan)">
                    <f.icon size={18} strokeWidth={1.8} />
                  </span>
                  <span>
                    <span className="block font-medium text-(color:--fos-fg)">{f.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-(color:--fos-muted)">{f.body}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link href={CTA.secondary.href} className="fos-btn fos-btn-ghost mt-10" data-reveal>
              Try the Orb in the live demo
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>

        <div className="mt-20 border-t border-(color:--fos-line) pt-14">
          <h3 className="text-3xl leading-[1.08] font-medium tracking-[-0.03em] text-(color:--fos-fg) md:text-[2.5rem]" data-reveal>
            Ask it. The answer is drawn, not just written.
          </h3>
          <p className="fos-lead mt-4" data-reveal>
            Pick a person and one of their questions.
          </p>
          <div className="mt-10" data-reveal>
            <AskDemo />
          </div>
        </div>
      </ScrollReveal>
    </SectionShell>
  );
}
