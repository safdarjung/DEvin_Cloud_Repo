import type { ComponentType } from "react";
import type { SlideId, SlideProps } from "../slide-meta";
import { CostSlide, IdeaSlide, ThreadsSlide, TitleSlide } from "./opening";
import { AiRulesSlide, AiSlide, ModulesSlide, PeopleSlide } from "./product";
import { AbsentSlide, FeesSlide, ResultsSlide } from "./story";
import { PlainSlide, StartSlide, TrustSlide, TrySlide } from "./closing";

export const SLIDE_VIEWS: Record<SlideId, ComponentType<SlideProps>> = {
  title: TitleSlide,
  threads: ThreadsSlide,
  cost: CostSlide,
  idea: IdeaSlide,
  "story-absent": AbsentSlide,
  "story-fees": FeesSlide,
  "story-results": ResultsSlide,
  people: PeopleSlide,
  ai: AiSlide,
  "ai-rules": AiRulesSlide,
  modules: ModulesSlide,
  trust: TrustSlide,
  plain: PlainSlide,
  start: StartSlide,
  try: TrySlide,
};
