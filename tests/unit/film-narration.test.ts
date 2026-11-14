import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { NARRATION, audioPath, slotSeconds } from "../../src/components/home/film/narration";

const publicDir = join(__dirname, "../../public");
const manifest: Record<string, Record<string, number>> = JSON.parse(readFileSync(join(publicDir, "audio/manifest.json"), "utf8"));
const kinds = [
  ["the 90-second film", (id: string) => id === "fabric"],
  ["story films", (id: string) => id.startsWith("story-")],
  ["role films", (id: string) => id.startsWith("role-")],
] as const;

test("the music bed exists", () => {
  expect(existsSync(join(publicDir, "audio/music-bed.mp3"))).toBe(true);
});

describe.each(kinds)("narration of %s", (_name, pick) => {
  const films = NARRATION.filter((f) => pick(f.id));

  test("films of this kind are defined", () => {
    expect(films.length).toBeGreaterThan(0);
  });

  // A film is checked once narrate.mjs has put it in the manifest; films not yet narrated stay silent in the player.
  describe.each(films.filter((f) => manifest[f.id]).map((f) => [f.id, f] as const))("%s", (_id, film) => {
    test("every line has an audio file listed in the manifest", () => {
      for (const line of film.lines) {
        expect(existsSync(join(publicDir, audioPath(film.id, line.id))), `${film.id}/${line.id} file`).toBe(true);
        expect(manifest[film.id][line.id], `${film.id}/${line.id} manifest`).toBeGreaterThan(0);
      }
    });

    test("every line ends before the next one starts and inside the film", () => {
      film.lines.forEach((line, i) => {
        const seconds = manifest[film.id][line.id];
        expect(seconds, `${film.id}/${line.id}`).toBeLessThanOrEqual(slotSeconds(film, i));
        expect(line.from + Math.ceil(seconds * film.fps), `${film.id}/${line.id} inside film`).toBeLessThanOrEqual(film.durationInFrames);
      });
    });
  });
});
