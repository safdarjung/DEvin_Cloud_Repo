// "Fabric in 90 seconds": the one composition behind the landing-page player, the deck and public/film/fabric.mp4.
// Narrated since 2026-11-14 (owner request: spoken lines + a soft music bed, see narration.ts and FilmAudio). Every idea
// is still on screen as text, because the film gets forwarded muted on WhatsApp.
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { FONT } from "../../tour/explainer/kit";
import { FilmAudio } from "../../tour/explainer/FilmAudio";
import { Backdrop } from "../../tour/explainer/Stage";
import { PROBLEMS, THREAD } from "../story";
import { BRAND, FilmWipes } from "./film-kit";
import { FILM, type Span } from "./film-timeline";
import { AiScene, EndScene, NumbersScene, PeopleScene } from "./sections-close";
import { OpenScene, ProblemsMontage, WeaveScene } from "./sections-intro";
import { OutcomeScene, StoryStepScene, StoryTitleScene } from "./sections-story";

const at = (s: Span) => ({ from: s.from, durationInFrames: s.duration });
const montage = { from: FILM.problems[0].from, durationInFrames: FILM.weave.from - FILM.problems[0].from };

/** Backdrop blob colour for the section on screen; it changes under a wipe or a montage push. */
function accentAt(frame: number): string {
  if (frame < FILM.problems[0].from) return THREAD.office.color;
  if (frame < FILM.weave.from) {
    const k = FILM.problems.findLastIndex((s) => frame >= s.from);
    return THREAD[PROBLEMS[k].thread].color;
  }
  if (frame < FILM.storyTitle.from) return THREAD.exams.color;
  if (frame < FILM.people.from) return THREAD.attendance.color;
  if (frame < FILM.ai.from) return THREAD.parents.color;
  if (frame < FILM.numbers.from) return THREAD.exams.color;
  if (frame < FILM.end.from) return THREAD.learning.color;
  return BRAND;
}

export function FabricFilm() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="fabric-film" style={{ fontFamily: FONT }}>
      {/* The app's CSS reset is not present in the MP4 render page, so pin the box model here. */}
      <style>{".fabric-film *{box-sizing:border-box}"}</style>
      <Backdrop accent={accentAt(frame)} />
      <Sequence {...at(FILM.open)}>
        <OpenScene />
      </Sequence>
      <Sequence {...montage}>
        <ProblemsMontage />
      </Sequence>
      <Sequence {...at(FILM.weave)}>
        <WeaveScene />
      </Sequence>
      <Sequence {...at(FILM.storyTitle)}>
        <StoryTitleScene />
      </Sequence>
      {FILM.story.map((s, i) => (
        <Sequence key={s.from} {...at(s)}>
          <StoryStepScene index={i} />
        </Sequence>
      ))}
      <Sequence {...at(FILM.outcome)}>
        <OutcomeScene />
      </Sequence>
      <Sequence {...at(FILM.people)}>
        <PeopleScene />
      </Sequence>
      <Sequence {...at(FILM.ai)}>
        <AiScene />
      </Sequence>
      <Sequence {...at(FILM.numbers)}>
        <NumbersScene />
      </Sequence>
      <Sequence {...at(FILM.end)}>
        <EndScene />
      </Sequence>
      <FilmWipes cuts={FILM.cuts} />
      <FilmAudio filmId="fabric" />
    </AbsoluteFill>
  );
}
