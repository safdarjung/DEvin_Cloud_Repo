/**
 * FabricOS landing-page product videos. Records the REAL running app (demo tenant
 * `st-josephs-demo`) with CDP screencast, then encodes with ffmpeg.
 *
 * Prereqs:  dev server on http://localhost:3100, local Supabase up, demo tenant seeded,
 *           SEED_DEMO_PASSWORD in env or .env.local, Playwright browsers installed,
 *           ffmpeg on PATH (brew install ffmpeg) - falls back to Playwright's VP8-only ffmpeg.
 * Run:      node scripts/fabricos/record-videos.mjs            (all clips)
 *           node scripts/fabricos/record-videos.mjs agents roles   (selected clips)
 *           BASE_URL=http://localhost:3000 node scripts/fabricos/record-videos.mjs
 * Output:   public/fabricos/video/<id>.{webm,mp4,webp,vtt}
 *
 * Read-only: it only navigates, hovers, scrolls and selects. Nothing is submitted,
 * approved, published or generated. No app code, seed or DB is touched.
 */
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SLUG = "st-josephs-demo";
const W = 1440;
const H = 900;
const FPS = 25;
const OUT = "public/fabricos/video";
const CACHE = join(homedir(), "Library/Caches/ms-playwright");

const env = existsSync(".env.local")
  ? Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => /^[A-Z_0-9]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
    )
  : {};
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? env.SEED_DEMO_PASSWORD;
if (!PASSWORD) throw new Error("SEED_DEMO_PASSWORD missing (env or .env.local)");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (p) => `${BASE}/${SLUG}/${p}`;

/* ------------------------------ ffmpeg ------------------------------ */
function findFfmpeg() {
  const sys = spawnSync("ffmpeg", ["-version"]);
  if (sys.status === 0) return { bin: "ffmpeg", full: true };
  const pw = spawnSync("sh", ["-c", `ls ${CACHE}/ffmpeg-*/ffmpeg-mac | tail -1`]).stdout.toString().trim();
  if (!pw) throw new Error("no ffmpeg available");
  return { bin: pw, full: false };
}
const FF = findFfmpeg();

function encode(frames, t0, durMs, args, outFile) {
  return new Promise((resolve, reject) => {
    const p = spawn(FF.bin, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", ...args, "-an", outFile]);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exit ${c} for ${outFile}`))));
    const total = Math.ceil((durMs / 1000) * FPS);
    let fi = 0;
    for (let i = 0; i < total; i++) {
      const t = t0 + (i * 1000) / FPS;
      while (fi + 1 < frames.length && frames[fi + 1].ts <= t) fi++;
      p.stdin.write(frames[fi].buf);
    }
    p.stdin.end();
  });
}

/* ----------------------------- recorder ----------------------------- */
class Recorder {
  frames = [];
  cues = [];
  t0 = 0;
  cdp = null;
  paused = false;
  offset = 0; // total ms cut out (page-load waits), so the video skips loading skeletons
  _p = 0;
  now() {
    return Date.now() - this.offset;
  }
  /** Cut out whatever happens while fn runs (e.g. waiting for a route to finish loading). */
  async cut(page, fn) {
    this.paused = true;
    this._p = Date.now();
    let shot;
    try {
      await fn();
      shot = await page.screenshot({ type: "jpeg", quality: 90 });
    } finally {
      this.offset += Date.now() - this._p;
      this.paused = false;
    }
    // screencast only emits on repaint, so seed the first post-cut frame explicitly
    if (shot) this.frames.push({ ts: this.now(), buf: shot });
  }
  async attach(page) {
    this.cdp = await page.context().newCDPSession(page);
    this.cdp.on("Page.screencastFrame", (f) => {
      if (!this.paused) this.frames.push({ ts: this.now(), buf: Buffer.from(f.data, "base64") });
      this.cdp?.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    if (!this.t0) {
      // wait for first frame so t0 is a real frame time
      for (let i = 0; i < 100 && this.frames.length === 0; i++) await sleep(50);
      this.t0 = this.frames[0]?.ts ?? this.now();
    }
  }
  async detach() {
    if (!this.cdp) return;
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await this.cdp.detach().catch(() => {});
    this.cdp = null;
  }
  cue(text) {
    const now = this.now();
    const last = this.cues.at(-1);
    if (last && last.end == null) last.end = now;
    if (text) this.cues.push({ start: now, end: null, text });
  }
  async finish(id, posterAtSec) {
    this.cue(null);
    const end = this.now();
    const durMs = end - this.t0;
    mkdirSync(OUT, { recursive: true });
    const base = join(OUT, id);
    const vf = ["-vf", `scale=${W}:${H},format=yuv420p`];
    if (FF.full) {
      await encode(this.frames, this.t0, durMs, [...vf, "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2"], `${base}.webm`);
      await encode(this.frames, this.t0, durMs, [...vf, "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-profile:v", "high", "-movflags", "+faststart"], `${base}.mp4`);
    } else {
      await encode(this.frames, this.t0, durMs, [...vf, "-c:v", "libvpx", "-crf", "14", "-b:v", "1500k"], `${base}.webm`);
    }
    // poster: frame at posterAtSec
    const pt = this.t0 + posterAtSec * 1000;
    const pf = [...this.frames].reverse().find((f) => f.ts <= pt) ?? this.frames[0];
    const jpg = `${base}-poster.jpg`;
    writeFileSync(jpg, pf.buf);
    const webp = FF.full ? spawnSync(FF.bin, ["-y", "-loglevel", "error", "-i", jpg, "-c:v", "libwebp", "-quality", "82", `${base}.webp`]) : { status: 1 };
    if (webp.status === 0) spawnSync("rm", ["-f", jpg]);
    else spawnSync("mv", [jpg, `${base}.jpg`]);
    // captions
    const ts = (ms) => {
      const s = Math.max(0, ms) / 1000;
      const h = String(Math.floor(s / 3600)).padStart(2, "0");
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const sec = (s % 60).toFixed(3).padStart(6, "0");
      return `${h}:${m}:${sec}`;
    };
    const vtt = ["WEBVTT", ""];
    this.cues.forEach((c, i) => {
      vtt.push(String(i + 1), `${ts(c.start - this.t0)} --> ${ts((c.end ?? end) - this.t0)}`, c.text, "");
    });
    writeFileSync(`${base}.vtt`, vtt.join("\n"));
    const sizes = Object.fromEntries(["webm", "mp4", "webp", "jpg", "vtt"].filter((e) => existsSync(`${base}.${e}`)).map((e) => [e, statSync(`${base}.${e}`).size]));
    console.log(id, { durationSec: +(durMs / 1000).toFixed(1), frames: this.frames.length, ...sizes });
  }
}

/* ------------------------------ page helpers ------------------------------ */
const INIT = `
(() => {
  const boot = () => {
  const css = document.createElement('style');
  css.textContent = 'nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button]{display:none!important}' +
    '#__cur{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(17,17,17,.88);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;transition:transform .12s ease}' +
    '#__cur.down{transform:scale(.72)}' +
    '.__rip{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid rgba(17,17,17,.7);z-index:2147483646;pointer-events:none;animation:__rip .5s ease-out forwards}' +
    '@keyframes __rip{to{transform:scale(4);opacity:0}}';
  document.documentElement.appendChild(css);
  const mk = () => {
    const c = document.createElement('div'); c.id = '__cur';
    let x = +sessionStorage.getItem('__cx') || -50, y = +sessionStorage.getItem('__cy') || -50;
    c.style.left = x + 'px'; c.style.top = y + 'px';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; try { sessionStorage.setItem('__cx', e.clientX); sessionStorage.setItem('__cy', e.clientY); } catch {} }, true);
    addEventListener('mousedown', (e) => { c.classList.add('down'); const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
    addEventListener('mouseup', () => c.classList.remove('down'), true);
  };
  mk();
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();
})();`;

async function retry(fn, n = 3) {
  let err;
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await sleep(1500);
    }
  }
  throw err;
}

async function openAs(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, bypassCSP: true });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  await retry(async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
    await page.getByLabel("Email").fill(`${who}@demo.coolskool.test`);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
  });
  return page;
}

async function warm(page, paths) {
  for (const p of paths) {
    await retry(() => page.goto(url(p), { waitUntil: "networkidle", timeout: 120000 }));
  }
}

async function settle(page, ms = 800) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(ms);
}

/** Eased mouse glide to a point. */
async function glide(page, x, y, ms = 700) {
  const from = await page.evaluate(() => [+sessionStorage.getItem("__cx") || 700, +sessionStorage.getItem("__cy") || 450]);
  const steps = Math.max(12, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(from[0] + (x - from[0]) * e, from[1] + (y - from[1]) * e);
    await sleep(ms / steps);
  }
}
async function hover(page, loc, ms = 700) {
  await loc.first().scrollIntoViewIfNeeded({ timeout: 30000 }).catch(() => {});
  const b = await loc.first().boundingBox({ timeout: 30000 }).catch(() => null);
  if (!b) {
    console.warn("  (hover target missing, skipped)");
    return false;
  }
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, ms);
  return true;
}
async function click(page, loc, ms = 700) {
  if (!(await hover(page, loc, ms))) throw new Error("click target missing");
  await sleep(180);
  await loc.first().click();
}

/** Smooth-scroll the page's real scroller (window or inner container) by dy. */
async function scrollBy(page, dy, ms = 1400) {
  await page.evaluate(
    ([dy]) => {
      const cands = [document.scrollingElement, ...document.querySelectorAll("main, main *, body > div, body > div > *")];
      const el = cands.find((e) => e && e.scrollHeight > e.clientHeight + 40 && (e === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(e).overflowY)));
      (el ?? window).scrollTo?.({ top: (el?.scrollTop ?? 0) + dy, behavior: "smooth" });
    },
    [dy],
  );
  await sleep(ms);
}
async function scrollSidebar(page, dy, ms = 1400) {
  await page.evaluate(
    ([dy]) => {
      const nav = document.querySelector("aside nav, nav");
      const el = [nav, ...(nav ? [...nav.querySelectorAll("*")] : []), nav?.parentElement].find((e) => e && e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
      el?.scrollTo({ top: Math.max(0, el.scrollTop + dy), behavior: "smooth" });
    },
    [dy],
  );
  await sleep(ms);
}
/** Click a sidebar link, then cut the route-load wait out of the video. */
async function go(page, rec, slug, heading) {
  await click(page, nav(page, slug), 700);
  await rec.cut(page, async () => {
    await page.waitForURL((u) => u.pathname.endsWith(`/${slug}`), { timeout: 120000 });
    await page.getByRole("heading", { level: 1, name: heading }).first().waitFor({ timeout: 120000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForFunction(() => !document.querySelector('[class*="animate-pulse"], [aria-busy="true"]'), null, { timeout: 30000 }).catch(() => {});
    await sleep(500);
  });
}
const idle = (page, rec, urlPart) =>
  rec.cut(page, async () => {
    if (urlPart) await page.waitForURL((u) => u.href.includes(urlPart), { timeout: 120000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForFunction(() => !document.querySelector('[class*="animate-pulse"], [aria-busy="true"]'), null, { timeout: 30000 }).catch(() => {});
    await sleep(500);
  });
const nav = (page, slug) => page.locator(`a[href="/${SLUG}/${slug}"]`).first();

/* -------------------------------- clips -------------------------------- */
const CLIPS = {
  async overview(browser, rec) {
    const page = await openAs(browser, "principal");
    await warm(page, ["admissions", "attendance", "finance", "exams", "dashboard"]);
    await settle(page);
    await rec.attach(page);
    rec.cue("Principal dashboard: students, staff, fees collected, overdue invoices and open enquiries at a glance. Demo mode, sample data.");
    await sleep(1800);
    await hover(page, page.getByText("Collected this term").first(), 900);
    await sleep(900);
    await scrollBy(page, 420, 1500);
    await sleep(1800);
    await scrollBy(page, -420, 1200);
    rec.cue("The sidebar groups the school's modules: academics, operations, communication and more.");
    await hover(page, nav(page, "students"), 800);
    await scrollSidebar(page, 520, 1800);
    await sleep(900);
    await scrollSidebar(page, -520, 1400);
    rec.cue("Admissions: the enquiry pipeline, grouped by stage.");
    await go(page, rec, "admissions", /Admissions pipeline/);
    await settle(page, 1600);
    await scrollBy(page, 360, 1400);
    await sleep(1500);
    rec.cue("Attendance, tracked by section and day.");
    await go(page, rec, "attendance", /Attendance/);
    await settle(page, 2200);
    rec.cue("Finance: fee collection, invoices and defaulters.");
    await go(page, rec, "finance", /Finance/);
    await settle(page, 1800);
    await scrollBy(page, 300, 1300);
    await sleep(1200);
    rec.cue("Exams: upcoming exams, results and recheck requests.");
    await go(page, rec, "exams", /Exams/);
    await settle(page, 2200);
    rec.cue("One workspace for the whole school, with each person seeing only what their role allows.");
    await go(page, rec, "dashboard", /Good morning/);
    await settle(page, 2200);
    await rec.detach();
    await page.context().close();
    return 1.5;
  },

  async agents(browser, rec) {
    const page = await openAs(browser, "principal");
    await warm(page, ["fabric/agents"]);
    await settle(page);
    await rec.attach(page);
    rec.cue("AI workforce: helpers that propose work. Risky actions wait for a person's approval.");
    await sleep(1500);
    await hover(page, page.getByText("Agents only propose actions", { exact: false }).first(), 900);
    await sleep(1200);
    rec.cue("Each agent lists what it can look at and what it can suggest, and whether a suggestion needs approval.");
    await scrollBy(page, 330, 1500);
    await hover(page, page.getByText("Attendance agent", { exact: true }).first(), 900);
    await sleep(1500);
    rec.cue("Example prompts show what each agent can be asked to do.");
    await hover(page, page.getByText("Find sections with attendance below 80% this week").first(), 900);
    await sleep(1800);
    await scrollBy(page, 360, 1500);
    await sleep(1200);
    await rec.detach();
    await page.context().close();
    return 1.5;
  },

  async automation(browser, rec) {
    const page = await openAs(browser, "principal");
    await warm(page, ["fabric/agents", "fabric/workflows"]);
    await settle(page);
    await rec.attach(page);
    rec.cue("Workflows: automations that check numbers, notify people, ask agents and wait for approval.");
    await sleep(1600);
    await hover(page, page.getByText("Fee reminder").first(), 900);
    await sleep(1000);
    rec.cue("Each workflow lists when it starts and the steps it runs, such as overdue invoices, notify finance, send reminders.");
    await hover(page, page.getByText("Stale enquiries", { exact: false }).first(), 900);
    await sleep(1500);
    rec.cue("Agent work that changes data is held for a person to review before anything runs.");
    await go(page, rec, "fabric/agents", /Agents/);
    await settle(page, 600);
    await scrollBy(page, 3000, 1800);
    const row = page.locator("tr", { hasText: /awaiting/i }).getByRole("link").first();
    await sleep(900);
    await click(page, row, 900);
    await idle(page, rec, "run=");
    await sleep(1200);
    rec.cue("The run shows what the agent proposes. Nothing has been executed until an authorised person approves or rejects.");
    await hover(page, page.getByRole("button", { name: /Approve and execute/ }), 1000);
    await sleep(2200);
    await rec.detach();
    await page.context().close();
    return 1.5;
  },

  async insights(browser, rec) {
    const page = await openAs(browser, "principal");
    await warm(page, ["fabric/lab", "fabric/insights"]);
    await page.locator('main a[href*="insights?id="]').first().waitFor({ timeout: 90000 });
    await settle(page);
    await rec.attach(page);
    rec.cue("Insights: patterns found in the school's data. Facts are computed by rules; AI only explains them.");
    await sleep(1800);
    await hover(page, page.locator("main").getByRole("link", { name: "Finance", exact: true }).first(), 800);
    await sleep(700);
    rec.cue("Filter by domain, then open an insight to see its evidence and history.");
    await click(page, page.locator('main a[href*="insights?id="]').first(), 800);
    await idle(page, rec, "id=");
    await sleep(2200);
    rec.cue("Analysis lab: attendance against marks, and sections that stand out from the school average.");
    await go(page, rec, "fabric/lab", /Analysis lab/);
    await settle(page, 1400);
    await scrollBy(page, 340, 1500);
    await sleep(1800);
    await rec.detach();
    await page.context().close();
    return 1.5;
  },

  async roles(browser, rec) {
    const teacher = await openAs(browser, "teacher.vi-a");
    const parent = await openAs(browser, "guardian.one");
    await warm(teacher, ["today"]);
    await warm(parent, ["portal"]);
    await settle(teacher);
    await settle(parent);
    await teacher.bringToFront();
    await rec.attach(teacher);
    rec.cue("Teacher: today's registers, marks to enter and submissions to grade for their own class.");
    await sleep(1800);
    await hover(teacher, teacher.getByText("Today's registers").first(), 900);
    await sleep(1300);
    await scrollBy(teacher, 360, 1500);
    await sleep(1800);
    await rec.detach();
    await parent.bringToFront();
    await rec.attach(parent);
    rec.cue("Parent: the same school, seen through a guardian's portal for their own children only.");
    await sleep(1800);
    await hover(parent, parent.getByText("Fees due").first(), 900);
    await sleep(1300);
    await scrollBy(parent, 340, 1500);
    await sleep(1800);
    await rec.detach();
    await teacher.context().close();
    await parent.context().close();
    return 1.5;
  },
};

/* --------------------------------- main --------------------------------- */
const want = process.argv.slice(2);
const ids = want.length ? want : Object.keys(CLIPS);
const exe = existsSync(`${CACHE}/chromium_headless_shell-1228`)
  ? `${CACHE}/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`
  : undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
try {
  for (const id of ids) {
    if (!CLIPS[id]) throw new Error(`unknown clip ${id}`);
    const rec = new Recorder();
    const posterAt = await CLIPS[id](browser, rec);
    await rec.finish(id, posterAt);
  }
} finally {
  await browser.close();
}
