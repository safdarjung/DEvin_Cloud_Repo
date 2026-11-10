// Renders one MP4 per tour role with hyperframes (HTML composition -> MP4).
// Usage: pnpm tour:render [roleKey ...]   Output: public/tour/<role>.mp4
// The page is the real Remotion composition (src/components/tour/explainer/fallback-entry.tsx, bundled with
// esbuild) shown frame by frame, so the fallback matches the live explainer.
// Needs Node >= 22.18 (runs .ts imports), FFmpeg and a hyperframes-managed Chrome.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TOUR_ROLES } from "../../src/components/tour/roles.ts";
import {
  EXPLAINER_FPS,
  EXPLAINER_HEIGHT,
  EXPLAINER_WIDTH,
  explainerTimeline,
} from "../../src/components/tour/explainer/timeline.ts";

const root = resolve(import.meta.dirname, "../..");
const outDir = join(root, "public/tour");
const bin = (name) => join(root, "node_modules/.bin", name);
const entry = join(root, "src/components/tour/explainer/fallback-entry.tsx");
const MAX_BYTES = 1.5 * 1024 * 1024;

const page = (role) => {
  const seconds = explainerTimeline(role.features.length).durationInFrames / EXPLAINER_FPS;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${role.label} explainer</title>
<style>html,body{margin:0;background:#FFF8EC}#root{position:relative;width:${EXPLAINER_WIDTH}px;height:${EXPLAINER_HEIGHT}px;overflow:hidden}</style></head>
<body><div id="root" data-composition-id="root" data-width="${EXPLAINER_WIDTH}" data-height="${EXPLAINER_HEIGHT}" data-fps="${EXPLAINER_FPS}" data-start="0" data-duration="${seconds}">
<div id="explainer" class="clip" data-role="${role.key}" data-start="0" data-duration="${seconds}"></div>
</div><script src="explainer.js"></script></body></html>`;
};

const wanted = process.argv.slice(2);
const roles = TOUR_ROLES.filter((r) => wanted.length === 0 || wanted.includes(r.key));
mkdirSync(outDir, { recursive: true });

const buildDir = mkdtempSync(join(tmpdir(), "tour-bundle-"));
const bundle = join(buildDir, "explainer.js");
const built = spawnSync(
  bin("esbuild"),
  [entry, "--bundle", "--minify", "--jsx=automatic", '--define:process.env.NODE_ENV="production"', `--outfile=${bundle}`, "--log-level=error"],
  { stdio: "inherit" },
);
if (built.status !== 0) {
  rmSync(buildDir, { recursive: true, force: true });
  console.error("esbuild could not bundle the explainer");
  process.exit(1);
}

let failed = 0;
for (const role of roles) {
  const dir = mkdtempSync(join(tmpdir(), `tour-${role.key}-`));
  try {
    writeFileSync(join(dir, "index.html"), page(role));
    copyFileSync(bundle, join(dir, "explainer.js"));
    const out = join(outDir, `${role.key}.mp4`);
    const r = spawnSync(bin("hyperframes"), ["render", dir, "-o", out, "--crf", "34", "--quiet"], { stdio: "inherit" });
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
rmSync(buildDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
