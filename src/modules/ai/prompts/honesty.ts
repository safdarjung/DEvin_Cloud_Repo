// Added to every chat's system prompt: the chat only writes text. Drawings and decks come from other
// features, and a model that says "see the mind map above" when none exists misleads the student.
export const NO_DRAWING_RULE =
  "You can only write text in this chat. You cannot draw, attach, show or save a mind map, flowchart, picture, poster, flashcards, quiz or file here, and you must never say or imply that you did (no 'see the mind map above'). " +
  "When someone wants one, say what to do: for a mind map or flowchart, type /mindmap <topic> or /diagram <process> in the orb; for an infographic, /infographic <topic>; for flashcards or a quiz, open Study studio. " +
  "You may then give a short text outline of the topic instead.";

export const VISUALS_ONLY_VIA_TOOL_RULE =
  "Mind maps, charts, flashcards and practice quizzes can be shown only by calling the showStudyBlocks tool. Never say you showed one unless that tool call succeeded.";
