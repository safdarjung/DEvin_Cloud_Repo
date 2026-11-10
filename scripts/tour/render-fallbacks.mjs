// Renders one MP4 per tour role with hyperframes (HTML composition -> MP4).
// Usage: pnpm tour:render [roleKey ...]   Output: public/tour/<role>.mp4
// Needs Node >= 22.18 (runs .ts imports), FFmpeg and a hyperframes-managed Chrome.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Lucide from "lucide-react";
import { TOUR_ROLES } from "../../src/components/tour/roles.ts";
import {
  EXPLAINER_FPS,
  explainerTimeline,
} from "../../src/components/tour/explainer/timeline.ts";

const root = resolve(import.meta.dirname, "../..");
const outDir = join(root, "public/tour");
const bin = join(root, "node_modules/.bin/hyperframes");
const gsapFile = join(root, "node_modules/gsap/dist/gsap.min.js");
const MAX_BYTES = 1.5 * 1024 * 1024;
const sec = (frames) => frames / EXPLAINER_FPS;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function iconSvg(name) {
  const c = Lucide[name];
  const ok = /^[A-Z]/.test(name) && c && (typeof c === "function" || typeof c === "object");
  return renderToStaticMarkup(createElement(ok ? c : Lucide.Sparkles, { size: 130, color: "#fff", strokeWidth: 2.6 }));
}

const css = (accent) => `
*{box-sizing:border-box}html,body{margin:0;background:#FFF8EC}
#root{position:relative;width:1280px;height:720px;overflow:hidden;background:#FFF8EC;font-family:"Nunito","Segoe UI",system-ui,sans-serif;color:#1F2937}
.blob{position:absolute;border-radius:50%;background:${accent}}
.scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center}
.beat{flex-direction:row;justify-content:flex-start;gap:56px;padding:0 80px;text-align:left}
.chip{display:inline-block;padding:8px 22px;border-radius:999px;border:4px solid #1F2937;background:#fff;font-weight:900;font-size:28px;text-transform:uppercase;letter-spacing:1px}
.tile{width:250px;height:250px;flex:none;border:5px solid #1F2937;border-radius:36px;box-shadow:0 10px 0 #1F2937;background:${accent};display:grid;place-items:center}
h1{font-size:150px;margin:20px 0 0;line-height:1;font-weight:900}
h2{font-size:84px;line-height:1.05;margin:18px 0 10px;font-weight:900}
p{font-size:38px;line-height:1.3;margin:0;font-weight:700;color:#374151;max-width:760px}
.tag p{max-width:900px;margin-top:28px}
.row{display:flex;gap:14px;align-items:center}
.warn{background:#FFD84D}
.mock{margin-top:30px;width:440px;padding:28px;border:5px solid #1F2937;border-radius:36px;box-shadow:0 10px 0 #1F2937;background:#fff;display:grid;gap:18px;transform-origin:left top}
.bar{height:34px;border-radius:17px;background:#EEE7D8;overflow:hidden}.bar i{display:block;height:100%;width:0;background:${accent};border-radius:17px;border-right:4px solid #1F2937}
.cta{margin-top:44px;padding:26px 64px;border-radius:999px;border:6px solid #1F2937;box-shadow:0 12px 0 #1F2937;background:${accent};color:#fff;font-size:60px;font-weight:900}
.end h2{font-size:96px;margin:0}`;

function composition(role) {
  const t = explainerTimeline(role.features.length);
  const total = sec(t.durationInFrames);
  const clip = (cls, span, body) =>
    `<div class="scene clip ${cls}" data-start="${sec(span.from)}" data-duration="${sec(span.duration)}">${body}</div>`;
  const title = clip(
    "tag title",
    t.title,
    `<div class="t-pop"><span class="chip" style="background:${role.accent}">${esc(role.room)}</span><h1>${esc(role.label)}</h1></div><p class="t-sub">${esc(role.tagline)}</p>`,
  );
  const beats = role.features
    .map((f, i) => {
      const label = f.label === "simulated" ? "Simulated" : f.label === "limited" ? "Limited" : "";
      const widths = [0, 1, 2].map((r) => ((((r === 0 ? 90 : r === 1 ? 62 : 78) + i * 7 + r * 11) % 45) + 45));
      return clip(
        `beat b${i}`,
        t.beats[i],
        `<div class="tile">${iconSvg(f.icon)}</div><div><div class="row"><span class="chip">${i + 1} / ${role.features.length}</span>${
          label ? `<span class="chip warn">${label}</span>` : ""
        }</div><h2>${esc(f.title)}</h2><p>${esc(f.blurb)}</p><div class="mock">${widths
          .map((w) => `<div class="bar"><i data-w="${w}"></i></div>`)
          .join("")}</div></div>`,
      );
    })
    .join("");
  const end = clip(
    "end",
    t.end,
    `<h2>Ready to look around?</h2><div class="cta">Try the ${esc(role.label)} demo</div>`,
  );
  // GSAP timeline mirrors the Remotion beats; back.out gives the bouncy overshoot.
  const script = `
const tl=gsap.timeline({paused:true});
const S=(q,p)=>document.querySelector(q);
tl.from(".blob",{y:20,duration:${total},ease:"sine.inOut",yoyo:true,repeat:1},0);
tl.from(".t-pop",{scale:0,duration:.6,ease:"back.out(2.4)"},.1).from(".t-sub",{y:40,opacity:0,duration:.5,ease:"back.out(1.6)"},.6);
${role.features
  .map((_, i) => {
    const s = sec(t.beats[i].from);
    return `tl.from(".b${i} .tile",{scale:0,rotation:-14,duration:.6,ease:"back.out(3)"},${s + 0.05})
.from(".b${i} h2",{x:-120,opacity:0,duration:.5,ease:"back.out(1.7)"},${s + 0.35})
.from(".b${i} p",{y:30,opacity:0,duration:.5,ease:"back.out(1.4)"},${s + 0.6})
.from(".b${i} .mock",{scale:0,duration:.5,ease:"back.out(2)"},${s + 0.8})
.to(".b${i} .bar i",{width:(k,el)=>el.dataset.w+"%",duration:.6,stagger:.12,ease:"back.out(1.3)"},${s + 1.0});`;
  })
  .join("\n")}
tl.from(".end h2",{scale:0,duration:.6,ease:"back.out(2.4)"},${sec(t.end.from) + 0.1}).from(".end .cta",{scale:0,duration:.6,ease:"back.out(3)"},${sec(t.end.from) + 0.5});
window.__timelines=window.__timelines||{};window.__timelines["root"]=tl;`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(role.label)} explainer</title>
<script src="gsap.min.js"></script><style>${css(role.accent)}</style></head>
<body><div id="root" data-composition-id="root" data-width="1280" data-height="720" data-fps="${EXPLAINER_FPS}" data-start="0" data-duration="${total}">
<div class="blob" style="width:520px;height:520px;left:-160px;top:-200px;opacity:.16"></div>
<div class="blob" style="width:360px;height:360px;left:1000px;top:480px;opacity:.22"></div>
${title}${beats}${end}
</div><script>${script}</script></body></html>`;
}

const wanted = process.argv.slice(2);
const roles = TOUR_ROLES.filter((r) => wanted.length === 0 || wanted.includes(r.key));
mkdirSync(outDir, { recursive: true });
let failed = 0;
for (const role of roles) {
  const dir = mkdtempSync(join(tmpdir(), `tour-${role.key}-`));
  try {
    writeFileSync(join(dir, "index.html"), composition(role));
    copyFileSync(gsapFile, join(dir, "gsap.min.js"));
    const out = join(outDir, `${role.key}.mp4`);
    const r = spawnSync(bin, ["render", dir, "-o", out, "--crf", "30", "--quiet"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`hyperframes exited ${r.status}`);
    const size = statSync(out).size;
    console.log(`${role.key}: ${(size / 1024).toFixed(0)} KB${size > MAX_BYTES ? " (over 1.5 MB cap)" : ""}`);
    if (size > MAX_BYTES) failed++;
  } catch (e) {
    failed++;
    console.error(`${role.key}: ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
