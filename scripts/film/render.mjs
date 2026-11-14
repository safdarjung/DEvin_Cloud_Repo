// Renders "Fabric in 90 seconds" with hyperframes (HTML composition -> MP4), plus a poster frame.
// Usage: pnpm film:render   Output: public/film/fabric.mp4, public/film/fabric-poster.jpg
// The page is the real Remotion composition (src/components/home/film/film-entry.tsx, bundled with esbuild)
// shown frame by frame, so the MP4 matches the live player. Same pipeline as scripts/tour/render-fallbacks.mjs.
// Needs Node >= 22.18 (runs .ts imports), FFmpeg and a hyperframes-managed Chrome.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FILM, FILM_FPS, FILM_HEIGHT, FILM_WIDTH } from "../../src/components/home/film/film-timeline.ts";

const root = resolve(import.meta.dirname, "../..");
const outDir = join(root, "public/film");
const out = join(outDir, "fabric.mp4");
const poster = join(outDir, "fabric-poster.jpg");
const bin = (name) => join(root, "node_modules/.bin", name);
const entry = join(root, "src/components/home/film/film-entry.tsx");
const MAX_BYTES = 8 * 1024 * 1024;
/** The poster shows the woven cloth with its line set, one frame the whole story hangs on. */
const POSTER_SECONDS = (FILM.weave.from + 150) / FILM_FPS;

/** The brand font, inlined as data URLs (latin + latin-ext for the rupee sign). Offline: warns, uses the system font. */
async function brandFontCss() {
  const get = (url) =>
    fetch(url, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" } }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r;
    });
  try {
    const css = await (await get("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..800&display=block")).text();
    const faces = css.split("/* ").filter((block) => /^latin(-ext)? \*\//.test(block));
    if (faces.length === 0) throw new Error("no latin faces in the font stylesheet");
    const inlined = await Promise.all(
      faces.map(async (block) => {
        const url = /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1];
        if (!url) throw new Error("no woff2 url in a font face");
        const data = Buffer.from(await (await get(url)).arrayBuffer()).toString("base64");
        return block.slice(block.indexOf("@font-face")).replace(url, `data:font/woff2;base64,${data}`);
      }),
    );
    return `${inlined.join("\n")}\n:root{--font-jakarta:"Plus Jakarta Sans"}`;
  } catch (e) {
    console.warn(`brand font not loaded (${e.message}); the MP4 uses the system font`);
    return "";
  }
}

const seconds = FILM.durationInFrames / FILM_FPS;
const page = (fontCss) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fabric in 90 seconds</title>
<style>${fontCss}</style>
<style>html,body{margin:0;background:#FFF8EC}#root{position:relative;width:${FILM_WIDTH}px;height:${FILM_HEIGHT}px;overflow:hidden}</style></head>
<body><div id="root" data-composition-id="root" data-width="${FILM_WIDTH}" data-height="${FILM_HEIGHT}" data-fps="${FILM_FPS}" data-start="0" data-duration="${seconds}">
<div id="film" class="clip" data-start="0" data-duration="${seconds}"></div>
</div><script src="film.js"></script></body></html>`;

mkdirSync(outDir, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "fabric-film-"));
let failed = false;
try {
  const built = spawnSync(
    bin("esbuild"),
    [entry, "--bundle", "--minify", "--jsx=automatic", '--define:process.env.NODE_ENV="production"', `--outfile=${join(dir, "film.js")}`, "--log-level=error"],
    { stdio: "inherit" },
  );
  if (built.status !== 0) throw new Error("esbuild could not bundle the film");
  writeFileSync(join(dir, "index.html"), page(await brandFontCss()));
  // hyperframes keeps its work folders beside the output, so render inside the temp dir and copy the result out.
  const tmpOut = join(dir, "fabric.mp4");
  const r = spawnSync(bin("hyperframes"), ["render", dir, "-o", tmpOut, "--crf", "30", "--quiet"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`hyperframes exited ${r.status}`);
  copyFileSync(tmpOut, out);
  const size = statSync(out).size;
  console.log(`fabric.mp4: ${(size / 1024 / 1024).toFixed(2)} MB, ${seconds.toFixed(1)} s${size > MAX_BYTES ? " (over the 8 MB cap)" : ""}`);
  if (size > MAX_BYTES) failed = true;
  const p = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(POSTER_SECONDS), "-i", out, "-frames:v", "1", "-q:v", "3", poster], { stdio: "inherit" });
  if (p.status !== 0) console.warn("poster not written (ffmpeg missing or failed); the MP4 is fine");
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
