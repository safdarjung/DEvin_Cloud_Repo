// Product previews for the landing film. Presentational only: fictional,
// non-identifying sample content that mirrors real Fabric screens (principal
// dashboard, attendance register, AI quiz generator, lesson plans, student
// portal + practice + study tools, guardian portal + assistant).
import type { ReactNode } from "react";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarCheck,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  School,
  Search,
  Send,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";

/* ---------- shared bits ---------- */

export function FabricMark({ className }: { className?: string }) {
  // Woven mark: two interlaced strands = connected roles.
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="fx-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c06bff" />
          <stop offset="1" stopColor="#7a1cf8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#fx-mark)" />
      <path d="M8 11c5 0 5 10 10 10s3-10 6-10" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 21c3 0 4-10 9-10s5 10 7 10" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`ui-card ${className}`}>
      {title ? <p className="ui-card-t">{title}</p> : null}
      {children}
    </div>
  );
}

function Kpi({ label, value, delta, down }: { label: string; value: string; delta?: string; down?: boolean }) {
  return (
    <div className="ui-card ui-kpi">
      <p className="ui-muted">{label}</p>
      <p className="ui-kpi-v">{value}</p>
      {delta ? <span className={`ui-pill ${down ? "is-red" : "is-green"}`}>{delta}</span> : null}
    </div>
  );
}

function Row({ left, right, sub }: { left: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="ui-row">
      <div>
        <p>{left}</p>
        {sub ? <p className="ui-muted">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

function Bars({ values, labels }: { values: number[]; labels?: string[] }) {
  return (
    <div className="ui-bars">
      {values.map((v, i) => (
        <div key={i} className="ui-bar">
          <i style={{ height: `${v}%` }} />
          {labels ? <span>{labels[i]}</span> : null}
        </div>
      ))}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="ui-meter">
      <div className="ui-meter-h">
        <span>{label}</span>
        <span className="ui-muted">{value}%</span>
      </div>
      <div className="ui-meter-t">
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Prompt({ children }: { children: ReactNode }) {
  return (
    <div className="ui-prompt">
      <span className="ui-avatar">You</span>
      <p>{children}</p>
    </div>
  );
}

function Answer({ children }: { children: ReactNode }) {
  return (
    <div className="ui-answer">
      <span className="ui-ai">
        <Sparkles aria-hidden /> Fabric AI
      </span>
      {children}
    </div>
  );
}

export function AreaChart({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 120" preserveAspectRatio="none" className={`ui-area ${className}`} aria-hidden>
      <defs>
        <linearGradient id="fx-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9312ff" stopOpacity=".55" />
          <stop offset="1" stopColor="#9312ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 86 C30 80 45 62 70 66 S110 88 135 72 175 40 200 46 240 70 265 58 305 24 330 30 370 44 400 22 L400 120 L0 120Z"
        fill="url(#fx-area)"
      />
      <path
        d="M0 86 C30 80 45 62 70 66 S110 88 135 72 175 40 200 46 240 70 265 58 305 24 330 30 370 44 400 22"
        fill="none"
        stroke="#b45cff"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ---------- desktop app chrome ---------- */

const PRINCIPAL_NAV = [
  { icon: LayoutDashboard, label: "Overview" },
  { icon: GraduationCap, label: "Students" },
  { icon: Users, label: "Teachers" },
  { icon: School, label: "Classes" },
  { icon: CalendarCheck, label: "Attendance" },
  { icon: BookOpen, label: "Academics" },
  { icon: MessageSquare, label: "Communication" },
  { icon: BarChart3, label: "Analytics" },
  { icon: Settings, label: "Settings" },
];

const TEACHER_NAV = [
  { icon: LayoutDashboard, label: "Today" },
  { icon: CalendarCheck, label: "Attendance" },
  { icon: ClipboardList, label: "Assignments" },
  { icon: GraduationCap, label: "Exams & marks" },
  { icon: BookOpen, label: "Lesson plans" },
  { icon: Sparkles, label: "Question bank" },
  { icon: MessageSquare, label: "Messages" },
];

function Sidebar({ nav, active, assistant = true }: { nav: typeof PRINCIPAL_NAV; active: string; assistant?: boolean }) {
  return (
    <aside className="ui-side">
      <div className="ui-brand">
        <FabricMark className="ui-brand-mark" />
        Fabric
        <Settings className="ui-brand-gear" aria-hidden />
      </div>
      <div className="ui-search">
        <Search aria-hidden /> Search
      </div>
      {nav.map(({ icon: Icon, label }) => (
        <div key={label} className={`ui-nav ${label === active ? "is-active" : ""}`}>
          <Icon aria-hidden /> {label}
        </div>
      ))}
      {assistant ? (
        <div className="ui-promo">
          <p className="ui-promo-t">Fabric AI</p>
          <p className="ui-muted">Your institution, intelligently connected.</p>
          <span className="ui-btn">Open Assistant</span>
        </div>
      ) : null}
    </aside>
  );
}

function Topbar({ title, user, role }: { title: string; user: string; role: string }) {
  return (
    <div className="ui-top">
      <span className="ui-top-t">{title}</span>
      <span className="ui-chip">Academic Year 2026–27</span>
      <span className="ui-top-search">
        <Search aria-hidden /> Search
      </span>
      <Bell className="ui-ico" aria-hidden />
      <span className="ui-user">
        <i className="ui-dot" />
        {user} <span className="ui-muted">· {role}</span>
      </span>
    </div>
  );
}

export function DesktopApp({ kind, active, children }: { kind: "principal" | "teacher"; active: string; children: ReactNode }) {
  const p = kind === "principal";
  return (
    <div className="ui-app">
      <Sidebar nav={p ? PRINCIPAL_NAV : TEACHER_NAV} active={active} assistant={p} />
      <div className="ui-main">
        <Topbar title={p ? "Institution Workspace" : "Class 8-B · Science"} user={p ? "A. Mehta" : "R. Iyer"} role={p ? "Principal" : "Teacher"} />
        <div className="ui-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- principal ---------- */

export function PrincipalOverview({ compact = false }: { compact?: boolean }) {
  return (
    <div className="ui-grid-dash">
      <div className="ui-kpis">
        <Kpi label="Students Enrolled" value="1,240" delta="+18 this term" />
        <Kpi label="Today's Attendance" value="96.4%" delta="+1.2%" />
        <Kpi label="Active Faculty" value="86" />
        <Kpi label="Pending Approvals" value="12" delta="4 urgent" down />
      </div>
      <Card className="ui-chart">
        <div className="ui-chart-h">
          <div>
            <p className="ui-card-t">Institutional Pulse</p>
            <p className="ui-muted">Attendance and academic activity</p>
          </div>
          <div className="ui-tabs">
            <span className="is-on">7 Days</span>
            <span>30 Days</span>
            <span>This Term</span>
          </div>
        </div>
        <AreaChart />
      </Card>
      <div className="ui-col">
        <Card title="Today's Priorities">
          <Row left="12 leave requests awaiting review" right={<ChevronRight className="ui-ico" aria-hidden />} />
          <Row left="24 assignments to review" right={<ChevronRight className="ui-ico" aria-hidden />} />
          <Row left="3 upcoming examinations" right={<ChevronRight className="ui-ico" aria-hidden />} />
          {compact ? null : <Row left="8 unread parent messages" right={<ChevronRight className="ui-ico" aria-hidden />} />}
        </Card>
        <Card title="AI Insights" className="ui-insight">
          <p>
            <Sparkles className="ui-ico ui-violet" aria-hidden /> Grade 8 attendance has improved this week.
          </p>
          {compact ? null : (
            <p>
              <Sparkles className="ui-ico ui-violet" aria-hidden /> Some classes may need academic follow-up.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

export function PrincipalAttendance() {
  const rows: [string, number, string][] = [
    ["Grade 6-A", 98, "—"],
    ["Grade 7-C", 91, "3 repeated absences"],
    ["Grade 8-B", 97, "—"],
    ["Grade 9-A", 88, "5 absent today"],
    ["Grade 10-B", 95, "—"],
  ];
  return (
    <div className="ui-split">
      <Card title="Class-wise attendance · today">
        {rows.map(([c, v, n]) => (
          <div key={c} className="ui-trow">
            <span>{c}</span>
            <div className="ui-meter-t">
              <i style={{ width: `${v}%` }} className={v < 92 ? "is-amber" : ""} />
            </div>
            <span className="ui-num">{v}%</span>
            <span className={n === "—" ? "ui-muted" : "ui-flag"}>{n}</span>
          </div>
        ))}
      </Card>
      <Card title="Attendance history · 4 weeks">
        <Bars values={[82, 90, 88, 94, 93, 96, 95, 97]} labels={["W1", "", "W2", "", "W3", "", "W4", ""]} />
        <p className="ui-muted">Absent today: 44 of 1,240 · guardians notified in-app</p>
      </Card>
    </div>
  );
}

export function PrincipalOperations() {
  return (
    <div className="ui-split">
      <Card title="Leave approvals">
        {[
          ["Staff leave · Science dept.", "2 days · Nov 12–13"],
          ["Student leave · Grade 7-C", "Medical · 3 days"],
          ["Staff leave · Admin office", "1 day · Nov 15"],
        ].map(([a, b]) => (
          <Row
            key={a}
            left={a}
            sub={b}
            right={
              <span className="ui-actions">
                <span className="ui-mini is-ok">
                  <Check aria-hidden /> Approve
                </span>
                <span className="ui-mini">
                  <X aria-hidden />
                </span>
              </span>
            }
          />
        ))}
      </Card>
      <div className="ui-col">
        <Card title="Admissions">
          <div className="ui-funnel">
            <span>
              <b>64</b> enquiries
            </span>
            <span>
              <b>31</b> applications
            </span>
            <span>
              <b>18</b> enrolled
            </span>
          </div>
        </Card>
        <Card title="Academic calendar">
          <Row left="Term 2 assessments" right={<span className="ui-muted">Nov 18</span>} />
          <Row left="Parent–teacher meeting" right={<span className="ui-muted">Nov 23</span>} />
          <Row left="Timetable published · Term 2" right={<Check className="ui-ico ui-green" aria-hidden />} />
        </Card>
      </div>
    </div>
  );
}

export function PrincipalAnalytics() {
  return (
    <div className="ui-split">
      <Card title="Subject performance · Term 1 average">
        <Meter label="Mathematics" value={72} />
        <Meter label="Science" value={78} />
        <Meter label="English" value={81} />
        <Meter label="Social Studies" value={75} />
        <Meter label="Hindi" value={79} />
      </Card>
      <Card title="Class performance trend">
        <Bars values={[62, 68, 71, 70, 76, 79]} labels={["Apr", "May", "Jul", "Aug", "Sep", "Oct"]} />
        <p className="ui-muted">Reports exportable for board and management reviews.</p>
      </Card>
    </div>
  );
}

export function PrincipalAssistant() {
  return (
    <div className="ui-chat">
      <Prompt>Summarize today&apos;s attendance and tell me which classes need attention.</Prompt>
      <Answer>
        <p>Attendance today is 96.4% (1,196 of 1,240 present).</p>
        <ul>
          <li>
            <b>Grade 9-A</b> is lowest at 88% — 5 students absent, 2 without a leave request.
          </li>
          <li>
            <b>Grade 7-C</b> has 3 students with repeated absences this week.
          </li>
          <li>All other classes are at or above 95%.</li>
        </ul>
        <p className="ui-muted">Suggested next step: review Grade 9-A and 7-C with class teachers. You decide what to send.</p>
      </Answer>
    </div>
  );
}

/* ---------- teacher ---------- */

const ROSTER = ["Aarav S.", "Diya M.", "Kabir R.", "Meera P.", "Rohan K.", "Saanvi T.", "Vihaan G.", "Zara N."];

export function TeacherAttendance() {
  return (
    <div className="ui-split ui-split--wide">
      <Card title="Class 8-B · Attendance · Thursday">
        <div className="ui-roster">
          {ROSTER.map((n, i) => {
            const absent = i === 2 || i === 6;
            return (
              <div key={n} className={`ui-student ${absent ? "is-absent" : ""}`}>
                <span className="ui-avatar ui-avatar--s">{n[0]}</span>
                {n}
                <span className={`ui-mini ${absent ? "is-bad" : "is-ok"}`}>{absent ? "Absent" : "Present"}</span>
              </div>
            );
          })}
        </div>
      </Card>
      <div className="ui-col">
        <Card className="ui-confirm">
          <Check className="ui-ico ui-green" aria-hidden />
          <p>
            <b>Register saved</b>
          </p>
          <p className="ui-muted">38 present · 2 absent</p>
          <p className="ui-muted">Guardians of absent students see it in their portal.</p>
        </Card>
      </div>
    </div>
  );
}

export function TeacherPerformance() {
  return (
    <div className="ui-split">
      <Card title="Class 8-B · Unit test 3 · Science">
        <Bars values={[48, 66, 74, 81, 58, 90, 77, 69]} />
        <p className="ui-muted">Class average 70% · 4 students below 50%</p>
      </Card>
      <div className="ui-col">
        <Card title="Learning progress">
          <Meter label="Force & pressure" value={82} />
          <Meter label="Friction" value={64} />
          <Meter label="Sound" value={71} />
        </Card>
        <Card title="Assignments">
          <Row left="Lab report · Friction" right={<span className="ui-pill is-green">32/40 in</span>} />
          <Row left="Worksheet · Sound" right={<span className="ui-pill">due Fri</span>} />
        </Card>
      </div>
    </div>
  );
}

export function TeacherQuiz() {
  return (
    <div className="ui-split ui-split--wide">
      <div className="ui-col">
        <Card title="AI quiz generator">
          <div className="ui-fields">
            <span className="ui-field">
              <i>Class</i>8
            </span>
            <span className="ui-field">
              <i>Subject</i>Science
            </span>
            <span className="ui-field">
              <i>Chapter</i>4 · Force & Pressure
            </span>
            <span className="ui-field">
              <i>Difficulty</i>Medium
            </span>
          </div>
          <Prompt>Create a 15-question quiz for tomorrow&apos;s Science class.</Prompt>
          <span className="ui-btn">
            <Sparkles aria-hidden /> Generate draft
          </span>
        </Card>
      </div>
      <Card title="Draft · 15 questions · review before publishing">
        {[
          ["1", "Which of these is a contact force?", "Muscular force"],
          ["2", "Pressure is defined as force per unit …", "Area"],
          ["3", "Why are the tyres of heavy trucks wide?", "To reduce pressure"],
          ["4", "Atmospheric pressure decreases with …", "Altitude"],
        ].map(([n, q, a]) => (
          <div key={n} className="ui-q">
            <span className="ui-qn">{n}</span>
            <div>
              <p>{q}</p>
              <p className="ui-muted">
                Answer: <span className="ui-green">{a}</span>
              </p>
            </div>
          </div>
        ))}
        <p className="ui-muted">+ 11 more · edit, remove or regenerate any question</p>
      </Card>
    </div>
  );
}

export function TeacherPlanning() {
  return (
    <div className="ui-split">
      <Card title="Syllabus completion · Class 8 Science">
        <Meter label="Term 1 chapters" value={100} />
        <Meter label="Chapter 4 · Force & Pressure" value={60} />
        <Meter label="Chapter 5 · Friction" value={15} />
      </Card>
      <div className="ui-col">
        <Card title="Lesson plan · Tomorrow, Period 3">
          <Row left="Objective" sub="Relate pressure to area with everyday examples" />
          <Row left="Activity" sub="Brick on sand · compare imprints" />
          <Row left="Material" sub="Chapter 4 notes · practice quiz" />
        </Card>
        <Card title="Upcoming">
          <Row left="Science unit test" right={<span className="ui-muted">Nov 18</span>} />
        </Card>
      </div>
    </div>
  );
}

export function TeacherMessage() {
  return (
    <div className="ui-split ui-split--wide">
      <Card title="Message to guardian · Kabir R.">
        <div className="ui-draft">
          <span className="ui-ai">
            <Sparkles aria-hidden /> Draft suggested by Fabric AI
          </span>
          <p>
            Dear Mr. Rao, Kabir has missed two Science periods this week. He is doing well in class discussions; we&apos;ve shared
            today&apos;s notes in his portal so he can catch up before Thursday&apos;s practice quiz.
          </p>
        </div>
        <div className="ui-actions">
          <span className="ui-btn">
            <Send aria-hidden /> Send
          </span>
          <span className="ui-mini">Edit</span>
        </div>
      </Card>
      <Card title="Recent messages">
        <Row left="Mrs. Menon" sub="Thank you for the update on Diya." />
        <Row left="Mr. Gupta" sub="Will Vihaan need the lab manual?" />
      </Card>
    </div>
  );
}

/* ---------- student (tablet) ---------- */

function MobileTop({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="ui-mtop">
      <FabricMark className="ui-brand-mark" />
      <div>
        <p className="ui-mtop-t">{title}</p>
        <p className="ui-muted">{sub}</p>
      </div>
      <Bell className="ui-ico ui-mtop-bell" aria-hidden />
    </div>
  );
}

export function StudentHome() {
  return (
    <div className="ui-mobile">
      <MobileTop title="Hi, Ananya" sub="Class 8-B · Thursday" />
      <div className="ui-split">
        <Card title="Today's timetable">
          <Row left="Science" right={<span className="ui-muted">9:00</span>} />
          <Row left="Mathematics" right={<span className="ui-muted">10:00</span>} />
          <Row left="English" right={<span className="ui-muted">11:30</span>} />
        </Card>
        <div className="ui-col">
          <Card title="Due soon">
            <Row left="Lab report · Friction" right={<span className="ui-pill">Fri</span>} />
            <Row left="Maths worksheet 6" right={<span className="ui-pill">Mon</span>} />
          </Card>
          <div className="ui-kpis ui-kpis--2">
            <Kpi label="Attendance" value="97%" />
            <Kpi label="Next exam" value="Nov 18" />
          </div>
        </div>
      </div>
      <Card title="Recommended for you" className="ui-insight">
        <p>
          <Sparkles className="ui-ico ui-violet" aria-hidden /> Revise “Pressure in fluids” — 10-minute practice ready.
        </p>
      </Card>
    </div>
  );
}

export function StudentTutor() {
  return (
    <div className="ui-mobile">
      <MobileTop title="AI study companion" sub="Grounded in your Class 8 curriculum" />
      <div className="ui-chat">
        <Prompt>Can you explain Newton&apos;s third law with an easy example?</Prompt>
        <Answer>
          <p>
            <b>Every action has an equal and opposite reaction.</b>
          </p>
          <ul>
            <li>When you push a wall, the wall pushes back on you just as hard.</li>
            <li>A rocket pushes gas down; the gas pushes the rocket up.</li>
          </ul>
          <p className="ui-muted">Try it: what pushes you forward when you swim?</p>
        </Answer>
        <Prompt>Generate a quiz for Chapter 4.</Prompt>
      </div>
    </div>
  );
}

export function StudentQuiz() {
  return (
    <div className="ui-mobile">
      <MobileTop title="Practice · Chapter 4" sub="Question 3 of 10" />
      <div className="ui-progress">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < 2 ? "is-done" : i === 2 ? "is-on" : ""} />
        ))}
      </div>
      <Card>
        <p className="ui-qtitle">Why do heavy trucks have wide tyres?</p>
        {["To go faster", "To reduce pressure on the road", "To increase friction only", "To look stronger"].map((o, i) => (
          <div key={o} className={`ui-option ${i === 1 ? "is-picked" : ""}`}>
            <span>{String.fromCharCode(65 + i)}</span>
            {o}
          </div>
        ))}
      </Card>
      <div className="ui-actions ui-actions--end">
        <span className="ui-mini">Previous</span>
        <span className="ui-btn">Next</span>
      </div>
    </div>
  );
}

export function StudentResults() {
  return (
    <div className="ui-mobile">
      <MobileTop title="Quiz complete" sub="Chapter 4 · Force & Pressure" />
      <div className="ui-split">
        <Card className="ui-score">
          <p className="ui-score-v">8/10</p>
          <p className="ui-muted">Nice work — two to review</p>
        </Card>
        <Card title="Topic performance">
          <Meter label="Contact forces" value={100} />
          <Meter label="Pressure" value={75} />
          <Meter label="Fluids" value={50} />
        </Card>
      </div>
      <Card title="Review · Q7">
        <p>Liquid pressure increases with depth because the weight of liquid above increases.</p>
        <p className="ui-muted">You chose “because water is colder at the bottom”.</p>
      </Card>
    </div>
  );
}

export function StudentStudy() {
  return (
    <div className="ui-mobile">
      <MobileTop title="Study space" sub="Notebook · flashcards · mind maps" />
      <div className="ui-split">
        <Card title="Flashcards · Pressure">
          <div className="ui-flash">
            <p>What is the SI unit of pressure?</p>
            <span className="ui-muted">Tap to flip</span>
          </div>
        </Card>
        <Card title="Revision plan · this week">
          <Row left="Mon · Fluids practice" right={<Check className="ui-ico ui-green" aria-hidden />} />
          <Row left="Wed · Friction flashcards" right={<Clock className="ui-ico" aria-hidden />} />
          <Row left="Fri · Chapter 4 recap" right={<Clock className="ui-ico" aria-hidden />} />
        </Card>
      </div>
      <Card title="Your progress">
        <Meter label="Science" value={78} />
        <Meter label="Mathematics" value={71} />
      </Card>
    </div>
  );
}

/* ---------- parent (phone) ---------- */

export function ParentToday() {
  return (
    <div className="ui-mobile ui-phone">
      <MobileTop title="Ananya · Class 8-B" sub="Today" />
      <Card className="ui-confirm">
        <Check className="ui-ico ui-green" aria-hidden />
        <p>
          <b>Present today</b>
        </p>
        <p className="ui-muted">Marked 8:52 AM by class teacher</p>
      </Card>
      <Card title="This month">
        <Row left="Attendance" right={<b>97%</b>} />
        <Row left="Upcoming exam" right={<span className="ui-muted">Science · Nov 18</span>} />
      </Card>
    </div>
  );
}

export function ParentProgress() {
  return (
    <div className="ui-mobile ui-phone">
      <MobileTop title="Academic progress" sub="Term 1 · published results" />
      <Card>
        <Meter label="Science" value={78} />
        <Meter label="Mathematics" value={71} />
        <Meter label="English" value={84} />
      </Card>
      <Card title="Teacher feedback">
        <p>Curious and engaged in class. Keep practising numericals in Chapter 4.</p>
      </Card>
    </div>
  );
}

export function ParentHomework() {
  return (
    <div className="ui-mobile ui-phone">
      <MobileTop title="Assignments" sub="2 pending" />
      <Card>
        <Row left="Lab report · Friction" sub="Science · due Friday" right={<span className="ui-pill">Pending</span>} />
        <Row left="Maths worksheet 6" sub="due Monday" right={<span className="ui-pill">Pending</span>} />
        <Row left="Essay · My city" sub="English" right={<span className="ui-pill is-green">Submitted</span>} />
      </Card>
    </div>
  );
}

export function ParentMessage() {
  return (
    <div className="ui-mobile ui-phone">
      <MobileTop title="Ms. R. Iyer" sub="Science · class teacher" />
      <div className="ui-chat">
        <div className="ui-bubble">Ananya did very well in today&apos;s practice quiz — 8 out of 10. 🎉</div>
        <div className="ui-bubble ui-bubble--me">Thank you! We&apos;ll revise fluids this weekend.</div>
      </div>
      <Card title="Coming up">
        <Row left="Parent–teacher meeting" right={<span className="ui-muted">Nov 23</span>} />
      </Card>
    </div>
  );
}

export function ParentAssistant() {
  return (
    <div className="ui-mobile ui-phone">
      <MobileTop title="Ask Fabric" sub="About Ananya only" />
      <div className="ui-chat">
        <Prompt>Summarize my child&apos;s academic progress this month.</Prompt>
        <Answer>
          <ul>
            <li>Attendance 97%, no unexplained absences.</li>
            <li>Science quiz scores up from 6/10 to 8/10.</li>
            <li>Two assignments due this week.</li>
          </ul>
          <p className="ui-muted">Based on Ananya&apos;s published records.</p>
        </Answer>
      </div>
    </div>
  );
}
