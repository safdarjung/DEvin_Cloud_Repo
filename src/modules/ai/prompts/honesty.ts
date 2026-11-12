// Added to every chat's system prompt: the chat only writes text. Drawings and decks come from other
// features, and a model that says "see the mind map above" when none exists misleads the student.
export const NO_DRAWING_RULE =
  "You can only write text in this chat. You cannot draw, attach, show or save a mind map, flowchart, picture, poster, flashcards, quiz or file here, and you must never say or imply that you did (no 'see the mind map above'). " +
  "When someone wants one, say what to do: for a mind map or flowchart, type /mindmap <topic> or /diagram <process> in the orb; for an infographic, /infographic <topic>; for flashcards, /flashcards <topic>; for a full lesson plan (teachers), /lessonplan <chapter, class>; for a saved quiz, open Study studio. " +
  "You may then give a short text outline of the topic instead.";

export const VISUALS_ONLY_VIA_TOOL_RULE =
  "Mind maps, charts, flashcards and practice quizzes can be shown only by calling the showStudyBlocks tool. Never say you showed one unless that tool call succeeded.";

/** Every chat: help first, ask little. A dead end ("not found, check the title") is the worst answer. */
export const ACT_FIRST_RULE =
  "Help straight away with what the person said. Do not open with a list of questions: use sensible defaults (a 40-minute period, the classes and subjects they teach, tomorrow when they say tomorrow), do the work, and ask at most one short question at the end if something important is still missing. " +
  "When a lookup finds nothing (a unit, student or record), do not stop there: say it in one short line, then still do the useful part, for example write the content in your answer or show the card with the fields you have. Never ask the person to check an exact title.";
