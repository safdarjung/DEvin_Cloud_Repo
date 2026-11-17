#!/usr/bin/env node
// Walks every sidebar page as each demo role and records what a UX pass needs:
// a desktop and a phone screenshot per page, console/page errors, HTTP status,
// horizontal overflow, load time, the page heading, and visible text a demo would expose
// (leaked undefined/NaN/null, empty states, error lines, broken images). Read-only: it only navigates.
//
// Usage:
//   node scripts/dev/role-walk.mjs --base http://localhost:3210 [--roles principal,teacher.vi-a] [--out .webshots/walk] [--only finance] [--desktop-only]
// Prints one JSON line per role while running and writes <out>/report.json at the end.
// Needs NEXT_PUBLIC_DEMO_LOGIN_HINTS=true on the server (one-tap demo login, no password).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    roles: { type: "string", default: "principal,admin,admissions,accountant,examcontroller,teacher.vi-a,guardian.one,student.one" },
    out: { type: "string", default: ".webshots/walk" },
    only: { type: "string" },
    slug: { type: "string", default: "st-josephs-demo" },
    phone: { type: "boolean", default: true },
    "desktop-only": { type: "boolean", default: false },
  },
});

const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const MAX_SHOT_HEIGHT = 2600;
const report = [];

async function login(context, role) {
  const res = await context.request.post(`${args.base}/api/public/demo-login`, {
    form: { email: `${role}@demo.coolskool.test`, next: `/${args.slug}/dashboard` },
    headers: { origin: args.base },
    maxRedirects: 0,
  });
  const to = res.headers().location ?? "";
  if (to.includes("/login")) throw new Error(`demo login refused for ${role} (redirect ${to})`);
}

async function sidebarLinks(page) {
  const hrefs = await page.locator('nav a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const prefix = `/${args.slug}/`;
  return [...new Set(hrefs.filter((h) => h && h.startsWith(prefix)).map((h) => h.split("#")[0]))];
}

async function visit(page, url, file, size) {
  const errors = [];
  const onConsole = (m) => m.type() === "error" && errors.push(m.text().slice(0, 200));
  const onPageError = (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  await page.setViewportSize(size);
  const t0 = Date.now();
  let status = 0;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    status = res?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  } catch (e) {
    errors.push(`goto: ${String(e.message).slice(0, 160)}`);
  }
  const ms = Date.now() - t0;
  const facts = await page
    .evaluate(() => {
      const text = document.body.innerText;
      // Lines a person demoing would notice: leaked placeholders, broken values, empty pages, error banners.
      const pick = (re) => [...new Set((text.match(re) ?? []).map((s) => s.trim().slice(0, 90)))].slice(0, 6);
      return {
        h1: document.querySelector("h1")?.textContent?.trim().slice(0, 80) ?? null,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        height: document.documentElement.scrollHeight,
        errorText: /something went wrong|application error|unhandled|failed to load/i.test(text),
        leaks: pick(/[^\n]*\b(undefined|NaN|Invalid Date|\[object Object\]|lorem ipsum|TODO|null)\b[^\n]*/g),
        empties: pick(/[^\n]*\b(no [a-z ]{2,40} yet|nothing (to show|here)|no (records|data|results) (found|yet)?)[^\n]*/gi),
        problems: pick(/[^\n]*\b(could not|couldn't|failed|not configured|forbidden|permission denied|error)\b[^\n]*/gi),
        brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length,
        path: location.pathname,
      };
    })
    .catch(() => ({}));
  const height = Math.min(facts.height ?? size.height, MAX_SHOT_HEIGHT);
  await page
    .screenshot({ path: file, type: "jpeg", quality: 55, clip: { x: 0, y: 0, width: size.width, height }, fullPage: true })
    .catch((e) => errors.push(`shot: ${String(e.message).slice(0, 120)}`));
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  return { status, ms, errors, ...facts };
}

const browser = await chromium.launch();
try {
  for (const role of args.roles.split(",")) {
    const context = await browser.newContext({ viewport: SIZES.desktop });
    const page = await context.newPage();
    const dir = join(args.out, role);
    mkdirSync(dir, { recursive: true });
    try {
      await login(context, role);
      await page.goto(`${args.base}/${args.slug}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      let links = await sidebarLinks(page);
      if (args.only) links = links.filter((l) => l.includes(args.only));
      for (const link of links) {
        const name = link.replace(`/${args.slug}/`, "").replace(/[/?=&]/g, "_") || "root";
        const row = { role, link };
        for (const [kind, size] of Object.entries(SIZES)) {
          if (kind === "phone" && (!args.phone || args["desktop-only"])) continue;
          row[kind] = await visit(page, `${args.base}${link}`, join(dir, `${name}.${kind}.jpg`), size);
        }
        report.push(row);
      }
      console.log(JSON.stringify({ role, pages: links.length }));
    } catch (e) {
      console.log(JSON.stringify({ role, error: String(e.message) }));
    }
    await context.close();
    // Saved after every role so a long or interrupted run keeps what it has.
    writeFileSync(join(args.out, "report.json"), JSON.stringify(report, null, 1));
  }
} finally {
  await browser.close();
  writeFileSync(join(args.out, "report.json"), JSON.stringify(report, null, 1));
}
