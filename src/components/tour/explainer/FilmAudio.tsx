import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { audioPath, narrationFor } from "../../home/film/narration";
// Written by scripts/film/narrate.mjs. A line is played only once its file is listed here, so a film whose
// narration is not generated yet stays silent instead of requesting missing files.
import manifest from "../../../../public/audio/manifest.json";

const MUSIC_VOLUME = 0.12;
const FADE_SECONDS = 2;
const made = manifest as Record<string, Record<string, number>>;

/** Spoken lines at their start frames plus a looping music bed that fades out over the last two seconds. */
export function FilmAudio({ filmId }: { filmId: string }) {
  const { fps, durationInFrames } = useVideoConfig();
  const film = narrationFor(filmId);
  const lines = film?.lines.filter((l) => made[filmId]?.[l.id]) ?? [];
  if (!film || lines.length === 0) return null;
  const fade = FADE_SECONDS * fps;
  return (
    <>
      <Audio
        src={staticFile("audio/music-bed.mp3")}
        loop
        volume={(f) => MUSIC_VOLUME * interpolate(f, [durationInFrames - fade, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
      />
      {lines.map((l) => (
        <Sequence key={l.id} from={l.from} durationInFrames={Math.ceil(made[filmId][l.id] * fps) + 2}>
          <Audio src={staticFile(audioPath(filmId, l.id))} volume={1} />
        </Sequence>
      ))}
    </>
  );
}
