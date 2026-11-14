import {
  Banknote,
  BookOpen,
  Brain,
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  MessagesSquare,
  NotebookPen,
  ReceiptText,
  Sparkles,
  Table2,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { HOME_STATS } from "../stats";
import { PROBLEMS, THREAD, THREADS, type ThreadKey } from "../story";
import { HUB, SLOT } from "./pose";

/** The paper thing a school uses today, and the product screen that replaces it. Sample data throughout. */
const ART: Readonly<Record<ThreadKey, { paper: LucideIcon; product: LucideIcon; screen: string }>> = {
  attendance: { paper: ClipboardList, product: CalendarCheck, screen: "Register · Grade 6-A" },
  fees: { paper: ReceiptText, product: Banknote, screen: "Fees · Term 2" },
  exams: { paper: Table2, product: GraduationCap, screen: "Unit Test 2 · marks" },
  admissions: { paper: NotebookPen, product: ClipboardList, screen: "Admissions pipeline" },
  parents: { paper: MessagesSquare, product: Users, screen: "Parent portal · Aarav" },
  learning: { paper: BookOpen, product: Lightbulb, screen: "Study assistant" },
  office: { paper: Brain, product: LayoutDashboard, screen: "Today, whole school" },
};

const step = (k: number) => ({ "--k": k }) as CSSProperties;

function Rows({ rows }: { rows: readonly (readonly [string, string, ("good" | "bad" | "plain")?])[] }) {
  return (
    <ul className="s3-rows">
      {rows.map(([label, value, tone = "plain"], k) => (
        <li key={label} style={step(k)}>
          <span>{label}</span>
          <b data-tone={tone}>{value}</b>
        </li>
      ))}
    </ul>
  );
}

const SCREENS: Readonly<Record<ThreadKey, ReactNode>> = {
  attendance: (
    <>
      <Rows
        rows={[
          ["Aarav S.", "Present", "good"],
          ["Kabir M.", "Absent", "bad"],
          ["Meera P.", "Present", "good"],
        ]}
      />
      <p className="s3-foot">Marked once. Everyone reads one row.</p>
    </>
  ),
  fees: (
    <>
      <Rows
        rows={[
          ["Term 2 invoice", "₹14,500"],
          ["Paid · R-0412", "₹12,300", "good"],
          ["Still due", "₹2,200", "bad"],
        ]}
      />
      <p className="s3-foot">Each payment gets a numbered receipt.</p>
    </>
  ),
  exams: (
    <>
      <Rows
        rows={[
          ["English", "44 / 50"],
          ["Maths", "38 / 50"],
          ["Report card", "Published", "good"],
        ]}
      />
      <p className="s3-foot">Typed once. Checked before publishing.</p>
    </>
  ),
  admissions: (
    <>
      <ol className="s3-lanes">
        {(["Enquiry", "Applied", "Decided", "Enrolled"] as const).map((lane, k) => (
          <li key={lane} style={step(k)}>
            <span>{lane}</span>
            {Array.from({ length: 3 - Math.min(k, 2) }, (_, n) => (
              <i key={n} />
            ))}
          </li>
        ))}
      </ol>
      <p className="s3-foot">From website form to enrolled student.</p>
    </>
  ),
  parents: (
    <>
      <ul className="s3-tiles">
        {(
          [
            ["Attendance", "Present"],
            ["Homework", "2 to hand in"],
            ["Fees", "₹2,200 due"],
            ["Results", "Test 2 is out"],
          ] as const
        ).map(([label, value], k) => (
          <li key={label} style={step(k)}>
            <span>{label}</span>
            <b>{value}</b>
          </li>
        ))}
      </ul>
      <p className="s3-foot">One portal per family, for each child.</p>
    </>
  ),
  learning: (
    <>
      <div className="s3-chat">
        <p data-from="student" style={step(0)}>
          I am stuck on ½ + ¼.
        </p>
        <p data-from="ai" style={step(1)}>
          Hint: can you make the bottom numbers the same?
        </p>
        <p data-from="student" style={step(2)}>
          2⁄4 + 1⁄4 = 3⁄4
        </p>
      </div>
      <p className="s3-foot">Hints before answers, in {HOME_STATS.studyLanguages} languages.</p>
    </>
  ),
  office: (
    <>
      <ul className="s3-tiles">
        {(
          [
            ["Registers", "68 of 72 marked"],
            ["Collected today", "₹1.2 lakh"],
            ["Enquiries", "5 new"],
            ["Approvals", "4 waiting"],
          ] as const
        ).map(([label, value], k) => (
          <li key={label} style={step(k)}>
            <span>{label}</span>
            <b>{value}</b>
          </li>
        ))}
      </ul>
      <p className="s3-foot">One view of the day, with flags.</p>
    </>
  ),
};

/** Paper side of card i: what the school runs on today. */
export function PaperFace({ index }: { index: number }) {
  const problem = PROBLEMS[index];
  const Icon = ART[problem.thread].paper;
  return (
    <span className="s3-face s3-paper">
      <span className="s3-stamp">Today</span>
      <Icon aria-hidden className="s3-paper-icon" strokeWidth={1.6} />
      <span className="s3-paper-name">{problem.artefact}</span>
    </span>
  );
}

/** Product side of card i: a small tile when docked, the module's screen when it is at the front. */
export function ProductFace({ index }: { index: number }) {
  const problem = PROBLEMS[index];
  const art = ART[problem.thread];
  const Icon = art.product;
  return (
    <span className="s3-face s3-product">
      <span className="s3-tile">
        <Icon aria-hidden className="s3-tile-icon" strokeWidth={2} />
        <span>{THREAD[problem.thread].label}</span>
      </span>
      <span className="s3-screen">
        <span className="s3-screen-top">
          <Icon aria-hidden className="s3-screen-icon" strokeWidth={2.2} />
          {art.screen}
        </span>
        <span className="s3-screen-body">{SCREENS[problem.thread]}</span>
      </span>
    </span>
  );
}

/** A thread through the centre of every slot, row by row: drawn in once all seven cards are docked. */
function threadPath(): string {
  const x = (col: number) => (HUB.pad + SLOT.w / 2 + col * (SLOT.w + HUB.gap)) * 1000;
  const y = (row: number) => (HUB.header + HUB.pad + SLOT.h / 2 + row * (SLOT.h + HUB.gap)) * 1000;
  const turn = (HUB.w - HUB.pad * 0.4) * 1000;
  return `M${x(0)} ${y(0)}H${x(3)}C${turn} ${y(0)} ${turn} ${y(1)} ${x(3)} ${y(1)}H${x(0)}`;
}

/** The hub: one board with a slot for each of the seven threads, and a place for the AI rule. */
export function HubBoard() {
  return (
    <span className="s3-board">
      <span className="s3-board-top">
        <span className="lh-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <b>Fabric School</b>
        <span className="s3-board-chip">One record</span>
      </span>
      <svg className="s3-thread" viewBox={`0 0 ${HUB.w * 1000} ${HUB.h * 1000}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="s3-yarn" x1="0" x2="1" y1="0" y2="0">
            {THREADS.map((t, i) => (
              <stop key={t.key} offset={i / (THREADS.length - 1)} stopColor={t.color} />
            ))}
          </linearGradient>
        </defs>
        <path d={threadPath()} pathLength={1} />
      </svg>
      <span className="s3-slots">
        {PROBLEMS.map((p) => (
          <span key={p.thread} className="s3-slot" style={{ "--thread": THREAD[p.thread].color } as CSSProperties}>
            {THREAD[p.thread].label}
          </span>
        ))}
        <span className="s3-slot s3-slot-ai">
          <Sparkles aria-hidden />
          AI drafts. A person decides.
        </span>
      </span>
      <span className="s3-sheen" />
    </span>
  );
}
