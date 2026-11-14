// Ask the App Orb one question in a real browser and print its answer, to compare with figures read
// straight from the database (the owner's bar: every AI answer is checked as the role that asks it).
//
//   node scripts/dev/ask-orb.mjs "How many approvals are waiting for me?"
//   node scripts/dev/ask-orb.mjs "Who is absent in 8-A today?" --base http://localhost:3000 --slug st-josephs-demo --shot /tmp/a.png --wait 30000
//
// Uses the Playwright already in node_modules and the session the dev server gives a new browser (the demo
// principal, by auto sign-in). Open the server as `localhost`, not 127.0.0.1, or the page does not hydrate.
// It sends one real chat request: do not loop it (bursts return 429) and mind which database the server uses.
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const base = flag("base", "http://localhost:3210");
const slug = flag("slug", "st-josephs-demo");
const shot = flag("shot", "");
const wait = Number(flag("wait", "26000"));
const question = args[0];
if (!question) {
  console.error('usage: node scripts/dev/ask-orb.mjs "<question>" [--base URL] [--slug SLUG] [--shot FILE] [--wait MS]');
  process.exit(2);
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${base}/${slug}/orb?q=${encodeURIComponent(question)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(wait);
  const text = await page.evaluate(() => document.body.innerText);
  const at = text.indexOf(question);
  if (shot) await page.screenshot({ path: shot });
  console.log(JSON.stringify({ question, answer: at < 0 ? null : text.slice(at + question.length, at + question.length + 1200).trim() }));
} finally {
  await browser.close();
}
