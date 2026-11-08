"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";
import { ArrowRight, Menu, X } from "lucide-react";
import { PlanetRim, PlanetVideo, Starfield } from "./sky";
import {
  DesktopApp,
  FabricMark,
  ParentAssistant,
  ParentHomework,
  ParentMessage,
  ParentProgress,
  ParentToday,
  PrincipalAnalytics,
  PrincipalAssistant,
  PrincipalAttendance,
  PrincipalOperations,
  PrincipalOverview,
  StudentHome,
  StudentQuiz,
  StudentResults,
  StudentStudy,
  StudentTutor,
  TeacherAttendance,
  TeacherMessage,
  TeacherPerformance,
  TeacherPlanning,
  TeacherQuiz,
} from "./screens";
import "./film.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Same query as the `film` layout in film.css. */
const FILM_MQ = "(min-width: 900px) and (orientation: landscape) and (prefers-reduced-motion: no-preference)";
const MOTION_OK = "(prefers-reduced-motion: no-preference)";
const DASH_GLOW = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/e0e14572-12e1-4c08-b471-a21521844945.png";

const CTA = { book: "/contact", platform: "/product", signIn: "/login?switch=1" } as const;

const NAV = [
  { href: "#intro", label: "Home" },
  { href: CTA.platform, label: "Platform" },
  { href: "#principal", label: "For Schools" },
  { href: "#teacher", label: "For Teachers" },
  { href: "#student", label: "For Students" },
  { href: "#parent", label: "For Parents" },
] as const;

const CHAPTERS = [
  { id: "intro", label: "Introduction" },
  { id: "principal", label: "Principal" },
  { id: "teacher", label: "Teacher" },
  { id: "student", label: "Student" },
  { id: "parent", label: "Parent" },
  { id: "ecosystem", label: "Ecosystem" },
] as const;

type Device = "laptop" | "tablet" | "phone";
type Plate = "office" | "staff" | "home" | "work";
type Beat = { label: string; points: string; screen: ReactNode };
type RoleScene = {
  id: "principal" | "teacher" | "student" | "parent";
  time: string;
  chapter: string;
  title: string;
  lede: string;
  device: Device;
  plate: Plate;
  beats: Beat[];
  also?: string[];
};

const app = (kind: "principal" | "teacher", active: string, node: ReactNode) => (
  <DesktopApp kind={kind} active={active}>
    {node}
  </DesktopApp>
);

const SCENES: RoleScene[] = [
  {
    id: "principal",
    time: "8:05 AM · The principal's office",
    chapter: "Institutional management",
    title: "See your entire institution at a glance.",
    lede: "From attendance and academic performance to staff activity and daily operations, Fabric brings your entire institution into one intelligent command center.",
    device: "laptop",
    plate: "office",
    beats: [
      { label: "Institutional overview", points: "Students and faculty · school-wide attendance · activity", screen: app("principal", "Overview", <PrincipalOverview />) },
      { label: "Attendance intelligence", points: "Absent students · class-wise view · repeated absences · history", screen: app("principal", "Attendance", <PrincipalAttendance />) },
      { label: "Administrative operations", points: "Leave approvals · admissions · timetables · academic calendar", screen: app("principal", "Classes", <PrincipalOperations />) },
      { label: "Institutional analytics", points: "Academic trends · class performance · subject-level insight", screen: app("principal", "Analytics", <PrincipalAnalytics />) },
      { label: "Principal AI assistant", points: "Ask in plain language · answers stay within your permissions", screen: app("principal", "Overview", <PrincipalAssistant />) },
    ],
  },
  {
    id: "teacher",
    time: "11:20 AM · The staff room",
    chapter: "Teaching and academic operations",
    title: "Less administration. More time to teach.",
    lede: "Everything teachers need to manage their classes, track student progress, and create engaging learning experiences — all in one workspace.",
    device: "laptop",
    plate: "staff",
    beats: [
      { label: "Attendance", points: "Open a class · mark the register · absentees flagged", screen: app("teacher", "Attendance", <TeacherAttendance />) },
      { label: "Class performance", points: "Assessment scores · learning progress · assignment status", screen: app("teacher", "Exams & marks", <TeacherPerformance />) },
      { label: "AI quiz generation", points: "Class 8 · Science · Chapter 4 · Medium — a draft you review", screen: app("teacher", "Question bank", <TeacherQuiz />) },
      { label: "Lesson planning", points: "Syllabus completion · lesson plans · study material", screen: app("teacher", "Lesson plans", <TeacherPlanning />) },
      { label: "Parent communication", points: "AI-drafted updates the teacher edits and sends", screen: app("teacher", "Messages", <TeacherMessage />) },
    ],
    also: ["Marks and grading", "Assignment management", "Curriculum management"],
  },
  {
    id: "student",
    time: "5:10 PM · Home",
    chapter: "Personalised AI learning",
    title: "Learning that goes beyond the classroom.",
    lede: "Every student gets a personal learning space with their curriculum, assignments, examinations, study materials, and an AI companion that helps them understand more.",
    device: "tablet",
    plate: "home",
    beats: [
      { label: "Personal overview", points: "Timetable · homework · exams · attendance · recommendations", screen: <StudentHome /> },
      { label: "AI study companion", points: "Curriculum-aware explanations, in plain language", screen: <StudentTutor /> },
      { label: "Personalised quizzes", points: "Question navigation · progress · submission", screen: <StudentQuiz /> },
      { label: "Results that teach", points: "Explanations for wrong answers · topic-level performance", screen: <StudentResults /> },
      { label: "Study tools", points: "Notebook · flashcards · mind maps · revision planning", screen: <StudentStudy /> },
    ],
  },
  {
    id: "parent",
    time: "5:40 PM · Meanwhile, across town",
    chapter: "Parents and family engagement",
    title: "Always connected to their progress.",
    lede: "Stay informed about your child's attendance, academic progress, assignments, and school activities — without having to chase updates.",
    device: "phone",
    plate: "work",
    beats: [
      { label: "Today's attendance", points: "Know they made it to school", screen: <ParentToday /> },
      { label: "Academic progress", points: "Published results · subject performance · teacher feedback", screen: <ParentProgress /> },
      { label: "Assignments", points: "Pending homework and upcoming deadlines", screen: <ParentHomework /> },
      { label: "Teacher communication", points: "Messages and meetings with teachers", screen: <ParentMessage /> },
      { label: "Parent AI assistant", points: "Answers drawn only from your child's records", screen: <ParentAssistant /> },
    ],
    also: ["Leave applications", "Report cards", "Fee receipts", "Parent–teacher meetings", "School announcements", "Academic calendar"],
  },
];

const PILLARS = [
  { title: "Institution management", body: "Manage the institution's people, records, attendance, operations, and administration." },
  { title: "Connected academics", body: "Connect teachers, students, parents, classes, curriculum, assignments, and examinations." },
  { title: "AI-powered learning", body: "Give students and teachers personalised AI assistance, study tools, quizzes, and learning insights." },
  { title: "Institutional intelligence", body: "Turn institutional information into useful insights and smarter workflows — people make the decisions." },
];

/* ---------------- choreography ---------------- */

function heroEntrance(root: HTMLElement) {
  const q = gsap.utils.selector(root);
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.fromTo(q(".fx-nav"), { y: -20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8 })
    .fromTo(q(".fx-rim"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2 }, 0.1)
    .fromTo(q(".fx-h1 .fx-line > span"), { yPercent: 110 }, { yPercent: 0, duration: 1, stagger: 0.12 }, 0.35)
    .fromTo(q(".fx-lede"), { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8 }, 0.85)
    .fromTo(q(".fx-hero-btns"), { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8 }, 1)
    .fromTo(q(".fx-dash"), { y: 80, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.1 }, 1.1)
    .fromTo(q(".fx-dash .ui-side, .fx-dash .ui-kpi, .fx-dash .ui-chart, .fx-dash .ui-col"), { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.06 }, 1.4);
  return tl;
}

function heroScroll(root: HTMLElement) {
  const q = gsap.utils.selector(root);
  const hero = q("#intro")[0];
  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: hero, start: "top top", end: "+=220%", pin: true, scrub: 1 },
  });
  tl.to(q(".fx-hero-copy"), { y: -140, autoAlpha: 0, duration: 0.3 }, 0)
    .to(q(".fx-dash, .fx-dash-glow"), { y: -470, scale: 1.18, duration: 0.55, ease: "power1.inOut" }, 0)
    .to(q(".fx-rim, .fx-video, .fx-stars"), { autoAlpha: 0, duration: 0.3 }, 0.32)
    .to(q(".fx-dash, .fx-dash-glow"), { autoAlpha: 0, scale: 1.5, duration: 0.18 }, 0.55)
    .fromTo(q(".fx-approach"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12 }, 0.55)
    .fromTo(q(".fx-facade"), { scale: 0.32, yPercent: 8 }, { scale: 5.5, yPercent: 0, duration: 0.45, ease: "power2.in" }, 0.55)
    .fromTo(q(".fx-approach .fx-time"), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.08 }, 0.6)
    .to(q(".fx-approach .fx-time"), { autoAlpha: 0, duration: 0.06 }, 0.86)
    .fromTo(q(".fx-hero-flash"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.1 }, 0.9);
}

function sceneScroll(section: HTMLElement) {
  const q = gsap.utils.selector(section);
  const beats = q(".fx-state");
  const callouts = q(".fx-callout");
  const n = beats.length;
  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: section, start: "top top", end: `+=${(n + 2) * 80}%`, pin: true, scrub: 1 },
  });
  // Establish: arrive through the doorway light, environment settles.
  tl.fromTo(q(".fx-veil"), { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.6 }, 0)
    .fromTo(q(".fx-plate-inner"), { scale: 1.22 }, { scale: 1.04, duration: 1.4, ease: "power1.out" }, 0)
    .fromTo(q(".fx-time"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 0.2)
    .fromTo(q(".fx-eyebrow, .fx-lede-s"), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.1 }, 0.35)
    .fromTo(q(".fx-h2 .fx-mask > span"), { yPercent: 110 }, { yPercent: 0, duration: 0.45 }, 0.4)
    // Person and device: the device comes in at an angle, then the camera pushes in.
    .fromTo(
      q(".fx-device"),
      { autoAlpha: 0, xPercent: 18, rotateY: -24, rotateX: 10, scale: 0.78 },
      { autoAlpha: 1, xPercent: 0, rotateY: -12, rotateX: 6, scale: 0.88, duration: 0.7, ease: "power2.out" },
      0.3,
    )
    .to(q(".fx-device"), { rotateY: 0, rotateX: 0, scale: 1, duration: 0.7, ease: "power1.inOut" }, 1)
    .to(q(".fx-plate-inner"), { scale: 1.16, duration: 0.7 }, 1)
    .to(q(".fx-plate-dim"), { autoAlpha: 0.55, duration: 0.7 }, 1)
    .to(q(".fx-time"), { autoAlpha: 0, duration: 0.3 }, 1.2)
    .fromTo(q(".fx-callouts"), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 1.3)
    .fromTo(callouts[0], { "--on": 0 }, { "--on": 1, duration: 0.2 }, 1.4);

  // Workflow beats.
  let t = 1.7;
  for (let i = 1; i < n; i++) {
    tl.to(beats[i - 1], { autoAlpha: 0, y: -10, duration: 0.25 }, t)
      .fromTo(beats[i], { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.3 }, t + 0.1)
      .to(callouts[i - 1], { "--on": 0, duration: 0.2 }, t)
      .to(callouts[i], { "--on": 1, duration: 0.2 }, t + 0.1);
    t += 0.8;
  }
  // Pull back and leave through the next doorway.
  tl.to(q(".fx-device"), { scale: 0.86, yPercent: -4, duration: 0.6, ease: "power1.in" }, t + 0.2)
    .to(q(".fx-copy, .fx-callouts"), { autoAlpha: 0, duration: 0.3 }, t + 0.3)
    .fromTo(q(".fx-exit"), { scaleX: 0.015, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.55, ease: "power2.in" }, t + 0.45)
    .fromTo(q(".fx-exit-label"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.15 }, t + 0.85);
}

function interludeScroll(section: HTMLElement) {
  const q = gsap.utils.selector(section);
  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: section, start: "top top", end: "+=200%", pin: true, scrub: 1 },
  });
  tl.fromTo(q(".fx-veil"), { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.15 }, 0)
    .fromTo(q(".fx-world"), { z: -200 }, { z: 1150, duration: 1, ease: "power1.in" }, 0)
    .fromTo(q(".fx-warm"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7 }, 0.15)
    .fromTo(q(".fx-bell"), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.12 }, 0.08)
    .to(q(".fx-bell"), { autoAlpha: 0, y: -20, duration: 0.1 }, 0.32)
    .fromTo(q(".fx-over .fx-mask > span"), { yPercent: 110 }, { yPercent: 0, duration: 0.15, stagger: 0.08 }, 0.38)
    .to(q(".fx-over"), { autoAlpha: 0, duration: 0.1 }, 0.78)
    .fromTo(q(".fx-gate-light"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.14 }, 0.86);
}

function ecosystemScroll(section: HTMLElement) {
  const q = gsap.utils.selector(section);
  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: section, start: "top top", end: "+=160%", pin: true, scrub: 1 },
  });
  tl.fromTo(q(".fx-veil"), { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.2 }, 0)
    .fromTo(q(".fx-node"), { autoAlpha: 0, scale: 0.85 }, { autoAlpha: 1, scale: 1, duration: 0.3, stagger: 0.08 }, 0.1)
    .fromTo(q(".fx-link"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4, stagger: 0.06 }, 0.3)
    .fromTo(q(".fx-hub"), { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: "back.out(1.6)" }, 0.45)
    .fromTo(q(".fx-eco-copy"), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 0.6);
}

/* ---------------- component ---------------- */

export function FabricFilm() {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>("intro");
  const [menu, setMenu] = useState(false);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();

      mm.add(FILM_MQ, () => {
        el.dataset.film = "on";
        const lenis = new Lenis({ anchors: true });
        lenis.on("scroll", ScrollTrigger.update);
        const raf = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(raf);
        gsap.ticker.lagSmoothing(0);

        heroScroll(el);
        el.querySelectorAll<HTMLElement>("[data-scene]").forEach(sceneScroll);
        const interlude = el.querySelector<HTMLElement>("#afterschool");
        if (interlude) interludeScroll(interlude);
        const eco = el.querySelector<HTMLElement>("#ecosystem-film");
        if (eco) ecosystemScroll(eco);

        return () => {
          gsap.ticker.remove(raf);
          gsap.ticker.lagSmoothing(500, 33);
          lenis.destroy();
          delete el.dataset.film;
        };
      });

      mm.add(MOTION_OK, () => {
        heroEntrance(el);
        // Mobile/tablet: light reveals only, no pinning.
        if (!window.matchMedia(FILM_MQ).matches) {
          ScrollTrigger.batch(el.querySelectorAll(".fx-reveal"), {
            start: "top 88%",
            once: true,
            onEnter: (els) => gsap.fromTo(els, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, stagger: 0.08, ease: "power3.out" }),
          });
        }
      });

      // Chapter indicator (all modes). Created after pins so positions include pin spacing.
      for (const c of CHAPTERS) {
        const target = el.querySelector<HTMLElement>(`#${c.id}`);
        if (!target) continue;
        ScrollTrigger.create({
          trigger: target,
          start: "top 55%",
          end: "bottom 45%",
          onToggle: (self) => self.isActive && setActive(c.id),
        });
      }

      el.dataset.ready = "";
      const refresh = () => ScrollTrigger.refresh();
      void document.fonts?.ready.then(refresh);
      window.addEventListener("load", refresh, { once: true });
      // Deep link to a chapter: jump after pin spacing exists.
      if (location.hash) {
        const target = el.querySelector<HTMLElement>(location.hash);
        if (target) requestAnimationFrame(() => window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY));
      }
      return () => {
        window.removeEventListener("load", refresh);
        mm.revert();
      };
    },
    { scope: root },
  );

  return (
    <div ref={root} className="fx-root">
      <script
        // Hide entrance targets before first paint only when JS + motion are available.
        dangerouslySetInnerHTML={{ __html: `matchMedia("${MOTION_OK}").matches&&document.documentElement.classList.add("fx-js")` }}
      />
      <a href="#principal" className="fx-skip">
        Skip the introduction
      </a>

      <header className="fx-nav fx-enter">
        <Link href="/" className="fx-logo" aria-label="Fabric home">
          <FabricMark className="fx-logo-mark" />
          Fabric
        </Link>
        <nav aria-label="Primary" className="fx-menu">
          {NAV.map((n) =>
            n.href.startsWith("#") ? (
              <a key={n.label} href={n.href} className={active === n.href.slice(1) ? "is-active" : undefined} aria-current={active === n.href.slice(1) ? "true" : undefined}>
                {n.label}
              </a>
            ) : (
              <Link key={n.label} href={n.href}>
                {n.label}
              </Link>
            ),
          )}
        </nav>
        <div className="fx-nav-right">
          <Link href={CTA.signIn} className="fx-signin">
            Sign in
          </Link>
          <Link href={CTA.book} className="fx-btn fx-btn--primary fx-btn--sm">
            Book a Walkthrough
          </Link>
          <button type="button" className="fx-burger" aria-expanded={menu} aria-controls="fx-mobile-menu" onClick={() => setMenu((m) => !m)}>
            {menu ? <X aria-hidden /> : <Menu aria-hidden />}
            <span className="sr-only">{menu ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
        {menu ? (
          <nav id="fx-mobile-menu" aria-label="Mobile" className="fx-mobile-menu">
            {NAV.map((n) => (
              <a key={n.label} href={n.href} onClick={() => setMenu(false)}>
                {n.label}
              </a>
            ))}
            <Link href={CTA.signIn} onClick={() => setMenu(false)}>
              Sign in
            </Link>
            <Link href={CTA.book} className="fx-btn fx-btn--primary" onClick={() => setMenu(false)}>
              Book a Walkthrough
            </Link>
          </nav>
        ) : null}
      </header>

      <nav aria-label="Chapters" className="fx-chapters">
        <ol>
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <a href={`#${c.id}`} className={active === c.id ? "is-active" : undefined} aria-current={active === c.id ? "step" : undefined}>
                <span className="fx-ch-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="fx-ch-l">{c.label}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <main id="main">
        {/* 01 — Cosmic introduction */}
        <section id="intro" className="fx-hero" aria-labelledby="fx-hero-title">
          <Starfield className="fx-stars" />
          <div className="fx-stage">
            <PlanetRim className="fx-rim fx-enter" />
            <PlanetVideo className="fx-video" />
            <div className="fx-hero-copy">
              <h1 id="fx-hero-title" className="fx-h1">
                <span className="fx-line">
                  <span>
                    <span className="fx-grad">Fabric</span> The Operating System
                  </span>
                </span>
                <span className="fx-line">
                  <span>for Modern Education.</span>
                </span>
              </h1>
              <p className="fx-lede fx-enter">
                One connected platform for your entire educational institution. Bring administrators, teachers, students, and parents together
                through intelligent school management and personalised AI-powered learning.
              </p>
              <div className="fx-hero-btns fx-enter">
                <Link href={CTA.book} className="fx-btn fx-btn--primary">
                  Book a Walkthrough
                </Link>
                <a href="#principal" className="fx-btn fx-btn--ghost">
                  Explore the Experience
                </a>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- remote decorative glow, screen-blended */}
            <img className="fx-dash-glow" src={DASH_GLOW} alt="" aria-hidden loading="eager" onError={(e) => (e.currentTarget.style.display = "none")} />
            <div className="fx-dash fx-enter" role="img" aria-label="Preview of the Fabric principal dashboard with sample data: 1,240 students, 96.4% attendance today, 86 faculty, 12 pending approvals.">
              <div className="fx-dash-line" />
              <DesktopApp kind="principal" active="Overview">
                <PrincipalOverview compact />
              </DesktopApp>
            </div>
          </div>
          <div className="fx-approach" aria-hidden>
            <div className="fx-facade">
              <div className="fx-facade-wing" />
              <div className="fx-facade-core">
                <div className="fx-door" />
              </div>
              <div className="fx-facade-wing" />
            </div>
            <p className="fx-time">7:58 AM · Arriving at school</p>
          </div>
          <div className="fx-hero-flash" aria-hidden />
        </section>

        {SCENES.map((s, i) => (
          <Fragment key={s.id}>
            <RoleSection scene={s} index={i + 2} />
            {s.id === "teacher" ? <Interlude /> : null}
          </Fragment>
        ))}

        <p className="fx-note">Product previews use fictional sample data. AI suggests; people decide.</p>

        {/* 06 — Ecosystem */}
        <section id="ecosystem" className="fx-eco" aria-labelledby="fx-eco-title">
          <div id="ecosystem-film" className="fx-eco-film">
            <div className="fx-veil" style={{ background: "#0b0712" }} aria-hidden />
            <svg className="fx-links" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden>
              {[
                "M500 300 C380 300 300 160 190 130",
                "M500 300 C620 300 700 160 810 130",
                "M500 300 C380 300 300 440 190 470",
                "M500 300 C620 300 700 440 810 470",
              ].map((d) => (
                <path key={d} d={d} className="fx-link" pathLength={1} />
              ))}
            </svg>
            {[
              { cls: "tl", who: "Principal", where: "In the office", what: "Approvals, attendance, analytics" },
              { cls: "tr", who: "Teacher", where: "In the staff room", what: "Registers, marks, quizzes, plans" },
              { cls: "bl", who: "Student", where: "At home", what: "Practice, study tools, AI companion" },
              { cls: "br", who: "Parent", where: "At work", what: "Attendance, progress, messages" },
            ].map((n) => (
              <div key={n.cls} className={`fx-node fx-node--${n.cls} fx-reveal`}>
                <p className="fx-node-who">{n.who}</p>
                <p className="fx-node-where">{n.where}</p>
                <p className="fx-node-what">{n.what}</p>
              </div>
            ))}
            <div className="fx-hub fx-reveal">
              <FabricMark className="fx-hub-mark" />
              <span>One institution</span>
            </div>
            <div className="fx-eco-copy fx-reveal">
              <p className="fx-eyebrow">06 · The Fabric ecosystem</p>
              <h2 id="fx-eco-title" className="fx-h2">One school. Every role. One connected system.</h2>
              <p className="fx-lede-s">
                From institutional operations to personalised learning, Fabric brings the entire educational ecosystem together in one intelligent
                platform.
              </p>
            </div>
          </div>

          <div className="fx-pillars">
            {PILLARS.map((p) => (
              <div key={p.title} className="fx-pillar fx-reveal">
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>

          <div className="fx-final fx-reveal">
            <h2 className="fx-h2">The future of education works better together.</h2>
            <p className="fx-lede-s">Bring your institution, educators, students, and families together with Fabric.</p>
            <div className="fx-hero-btns">
              <Link href={CTA.book} className="fx-btn fx-btn--primary">
                Book a Walkthrough <ArrowRight aria-hidden />
              </Link>
              <Link href={CTA.platform} className="fx-btn fx-btn--ghost">
                Explore the Platform
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="fx-footer">
        <div className="fx-footer-brand">
          <FabricMark className="fx-logo-mark" />
          <div>
            <p className="fx-footer-name">Fabric</p>
            <p className="fx-footer-tag">The operating system that brings education together.</p>
          </div>
        </div>
        <nav aria-label="Footer" className="fx-footer-links">
          {[
            ["/product", "Platform"],
            ["/modules", "Modules"],
            ["/ai", "AI"],
            ["/security", "Security"],
            ["/pricing", "Pricing"],
            ["/faq", "FAQ"],
            ["/demo", "Try the demo"],
            ["/contact", "Contact"],
            ["/legal/privacy", "Privacy"],
            ["/legal/terms", "Terms"],
          ].map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}

function RoleSection({ scene: s, index }: { scene: RoleScene; index: number }) {
  // Exit colour of one scene = arrival veil of the next, so cuts read as one move.
  const next = { principal: "#d8cdb8", teacher: "#f2c48a", student: "#0e1220", parent: "#0b0712" }[s.id];
  const exitLabel = { principal: "Down the corridor, to the staff room", teacher: "", student: "Meanwhile, across town", parent: "" }[s.id];
  const veil = { principal: "#efe3cc", teacher: "#d8cdb8", student: "#f2c48a", parent: "#0e1220" }[s.id];
  return (
    <section id={s.id} data-scene className={`fx-scene fx-scene--${s.plate}`} aria-labelledby={`${s.id}-title`}>
      <div className={`fx-plate fx-plate--${s.plate}`} aria-hidden>
        <div className="fx-plate-inner">
          <div className="fx-window" />
          <div className="fx-shafts" />
          <div className="fx-prop" />
          <div className="fx-desk" />
        </div>
        <div className="fx-plate-dim" />
      </div>
      <p className="fx-time">{s.time}</p>
      <div className="fx-copy fx-reveal">
        <p className="fx-eyebrow">
          {String(index).padStart(2, "0")} · {s.chapter}
        </p>
        <h2 id={`${s.id}-title`} className="fx-h2">
          <span className="fx-mask">
            <span>{s.title}</span>
          </span>
        </h2>
        <p className="fx-lede-s">{s.lede}</p>
      </div>
      <div className={`fx-device fx-device--${s.device} fx-reveal`}>
        <div className="fx-screen">
          <ol className="fx-states" data-device={s.device}>
            {s.beats.map((b, i) => (
              <li key={b.label} className="fx-state" data-first={i === 0 || undefined}>
                <p className="fx-state-cap">{b.label}</p>
                <div className="fx-state-ui" role="img" aria-label={`${b.label} preview: ${b.points}`}>
                  {b.screen}
                </div>
              </li>
            ))}
          </ol>
        </div>
        {s.device === "laptop" ? <div className="fx-base" /> : null}
      </div>
      <ul className="fx-callouts fx-reveal">
        {s.beats.map((b) => (
          <li key={b.label} className="fx-callout">
            <span className="fx-callout-l">{b.label}</span>
            <span className="fx-callout-p">{b.points}</span>
          </li>
        ))}
        {s.also ? <li className="fx-also">Also: {s.also.join(" · ")}</li> : null}
      </ul>
      <div className="fx-veil" style={{ background: veil }} aria-hidden />
      <div className="fx-exit" style={{ background: next }} aria-hidden>
        {exitLabel ? <span className="fx-exit-label">{exitLabel}</span> : null}
      </div>
    </section>
  );
}

/** Teacher → student: the final bell, down the corridor, out through the gates. */
function Interlude() {
  return (
    <section id="afterschool" className="fx-inter" aria-labelledby="fx-inter-title">
      <div className="fx-corridor" aria-hidden>
        <div className="fx-world">
          <div className="fx-wall fx-wall--l" />
          <div className="fx-wall fx-wall--r" />
          <div className="fx-floor" />
          <div className="fx-ceiling" />
          <div className="fx-end" />
        </div>
        <div className="fx-warm" />
        <div className="fx-gate-light" />
      </div>
      <div className="fx-veil" style={{ background: "#f2c48a" }} aria-hidden />
      <p className="fx-bell fx-reveal">3:30 PM · The final bell</p>
      <h2 id="fx-inter-title" className="fx-over fx-reveal">
        <span className="fx-mask">
          <span>The school day is over.</span>
        </span>
        <span className="fx-mask">
          <span className="fx-grad">Learning isn&apos;t.</span>
        </span>
      </h2>
    </section>
  );
}
