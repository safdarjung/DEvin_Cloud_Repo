// Narration + music for the films. Usage:
//   pnpm film:narrate [--force] [--only <film-id> ...] [--model <tts model>] [--mux]
// Writes public/audio/<film-id>/<line-id>.mp3 (Gemini TTS gemini-3.8-flash-tts by default, voice Kore, one call per line; existing files are
// kept unless --force), public/audio/manifest.json ({film: {line: seconds}}) and public/audio/music-bed.mp3
// (ffmpeg only). A line longer than its slot is sped up with atempo (max 1.15x) or reported so you can shorten it.
// --mux mixes narration + music into the existing MP4s (public/film/fabric.mp4, public/tour/<role>.mp4), video copied.
// Needs Node >= 22.18, ffmpeg/ffprobe and GEMINI_API_KEY in the environment or .env.local (never printed).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NARRATION, slotSeconds } from "../../src/components/home/film/narration.ts";

const root = resolve(import.meta.dirname, "../..");
const audioDir = join(root, "public/audio");
const manifestPath = join(audioDir, "manifest.json");
const bedPath = join(audioDir, "music-bed.mp3");
const VOICE = "Kore";
const MAX_SPEEDUP = 1.15;
const GAP = 0.15; // seconds of air kept before the next line
const MUSIC_VOLUME = 0.12;
const BED_SECONDS = 100;

const args = process.argv.slice(2);
const force = args.includes("--force");
const mux = args.includes("--mux");
const MODEL = args.includes("--model") ? args[args.indexOf("--model") + 1] : "gemini-3.8-flash-tts";
const only = args.flatMap((a, i) => (args[i - 1] === "--only" ? [a] : []));
const films = NARRATION.filter((f) => only.length === 0 || only.includes(f.id));

function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || "").trim().split("\n").slice(-3).join(" | ")}`);
  return r.stdout;
}
const seconds = (file) => Math.round(parseFloat(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])) * 1000) / 1000;

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const env = join(root, ".env.local");
  const hit = existsSync(env) && readFileSync(env, "utf8").split("\n").find((l) => l.startsWith("GEMINI_API_KEY="));
  if (!hit) throw new Error("GEMINI_API_KEY is not set (environment or .env.local)");
  return hit.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
}

let calls = 0;
async function speak(key, text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  // Send only the line: this model reads any style instruction aloud.
  const body = { contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } } };
  for (let attempt = 0; attempt < 6; attempt++) {
    calls++;
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) }).catch(() => null); // network blip: retry
    if (res?.ok) {
      const part = (await res.json()).candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (part?.data) return { pcm: Buffer.from(part.data, "base64"), rate: Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1] ?? 24000) };
    } else if (res && (![429, 500, 503].includes(res.status) || (res.status === 429 && /PerDay/.test(await res.text())))) {
      throw new Error(`Gemini HTTP ${res.status} (${MODEL})${res.status === 429 ? ": daily quota used up; retry tomorrow or pass --model <other tts model>" : ""}`);
    }
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw new Error("Gemini gave no audio after 6 tries");
}

// Trim leading and trailing silence so a line starts when the picture does.
const TRIM = "silenceremove=start_periods=1:start_threshold=-45dB:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-45dB:detection=peak,areverse";
function encode(pcm, rate, out) {
  const raw = `${out}.pcm`;
  writeFileSync(raw, pcm);
  try {
    run("ffmpeg", ["-y", "-loglevel", "error", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", raw, "-af", TRIM, "-c:a", "libmp3lame", "-q:a", "3", out]);
  } finally {
    rmSync(raw, { force: true });
  }
}
function speedUp(file, factor) {
  const tmp = `${file}.tmp.mp3`;
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-af", `atempo=${factor.toFixed(4)}`, "-c:a", "libmp3lame", "-q:a", "3", tmp]);
  renameSync(tmp, file);
}

function makeBed() {
  // A slow pad: A minor add9 chord tones, each detuned pair beating gently, slow tremolo, low-passed, long fades.
  const tones = [[110, 0.2], [164.81, 0.13], [220, 0.25], [220.7, 0.11], [261.63, 0.17], [329.63, 0.22], [493.88, 0.1]];
  const ins = tones.flatMap(([f]) => ["-f", "lavfi", "-i", `sine=f=${f}:d=${BED_SECONDS}:r=44100`]);
  const chains = tones.map(([, rate], i) => `[${i}:a]tremolo=f=${rate}:d=0.45,volume=0.9[t${i}]`);
  const graph = `${chains.join(";")};${tones.map((_, i) => `[t${i}]`).join("")}amix=inputs=${tones.length}:normalize=0,lowpass=f=1100,aecho=0.8:0.6:700|1100:0.3|0.2,volume=1.6,afade=t=in:d=5,afade=t=out:st=${BED_SECONDS - 8}:d=8,aformat=channel_layouts=stereo[out]`;
  run("ffmpeg", ["-y", "-loglevel", "error", ...ins, "-filter_complex", graph, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", bedPath]);
}

function muxFilm(film, target) {
  const dur = film.durationInFrames / film.fps;
  const inputs = ["-i", target, "-i", bedPath];
  const chains = [`[1:a]volume=${MUSIC_VOLUME},afade=t=out:st=${(dur - 2).toFixed(3)}:d=2,atrim=0:${dur.toFixed(3)}[m]`];
  film.lines.forEach((l, i) => {
    inputs.push("-i", join(audioDir, film.id, `${l.id}.mp3`));
    const ms = Math.round((l.from / film.fps) * 1000);
    chains.push(`[${i + 2}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms}[n${i}]`);
  });
  const labels = ["[m]", ...film.lines.map((_, i) => `[n${i}]`)].join("");
  const graph = `${chains.join(";")};${labels}amix=inputs=${film.lines.length + 1}:normalize=0:duration=longest,atrim=0:${dur.toFixed(3)},alimiter=limit=0.95[a]`;
  const tmp = `${target}.mux.mp4`;
  // -map 0:v:0 only: any audio already in the MP4 is dropped, so --mux is safe to repeat.
  run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-t", dur.toFixed(3), tmp]);
  renameSync(tmp, target);
}

const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const problems = [];
const key = films.some((f) => f.lines.some((l) => force || !existsSync(join(audioDir, f.id, `${l.id}.mp3`)))) ? apiKey() : "";
let made = 0;
let crash = null;
// A failed call (daily quota, network) must not lose the lines already made: the manifest is written either way.
try {
  for (const film of films) {
    mkdirSync(join(audioDir, film.id), { recursive: true });
    manifest[film.id] = {};
    for (const [i, line] of film.lines.entries()) {
      const file = join(audioDir, film.id, `${line.id}.mp3`);
      if (force || !existsSync(file)) {
        const { pcm, rate } = await speak(key, line.text);
        encode(pcm, rate, file);
        made++;
      }
      let len = seconds(file);
      const slot = slotSeconds(film, i) - GAP;
      if (len > slot) {
        const factor = len / slot;
        if (factor <= MAX_SPEEDUP) {
          speedUp(file, factor + 0.003);
          console.warn(`sped up ${film.id}/${line.id}: ${len.toFixed(2)} s into a ${slot.toFixed(2)} s slot (x${factor.toFixed(2)})`);
          len = seconds(file);
        } else {
          problems.push(`${film.id}/${line.id}: ${len.toFixed(2)} s, slot ${slot.toFixed(2)} s, shorten: "${line.text}"`);
          rmSync(file); // removed and left out of the manifest, so the film plays without it until the text is shortened and this runs again
          continue;
        }
      }
      manifest[film.id][line.id] = len;
    }
  }
} catch (e) {
  crash = e;
}
for (const id of Object.keys(manifest)) if (Object.keys(manifest[id]).length === 0) delete manifest[id]; // nothing narrated yet: no entry, the player stays silent
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${made} lines generated (${calls} Gemini calls), manifest written`);

if (force || !existsSync(bedPath)) {
  makeBed();
  console.log(`music-bed.mp3 written (${seconds(bedPath)} s)`);
}
if (crash) console.error(`stopped early: ${crash.message}. Run again to continue; finished lines are kept.`);
if (problems.length || crash) {
  if (problems.length) console.error(`Lines too long for their slot:\n${problems.join("\n")}`);
  process.exit(1);
}
if (mux) {
  const targets = { fabric: join(root, "public/film/fabric.mp4") };
  for (const film of films) {
    const target = targets[film.id] ?? (film.id.startsWith("role-") ? join(root, "public/tour", `${film.id.slice(5)}.mp4`) : "");
    if (!target || !existsSync(target)) continue;
    if (film.lines.some((l) => !manifest[film.id]?.[l.id])) {
      console.warn(`skipped ${film.id}: narration incomplete`);
      continue;
    }
    muxFilm(film, target);
    console.log(`muxed ${film.id} -> ${target.slice(root.length + 1)}`);
  }
}
