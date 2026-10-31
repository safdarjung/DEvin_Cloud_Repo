// Bug C fix — the AI SDK's DefaultChatTransport sets `error.message` to the
// raw HTTP response body (see `createUIApiCallError` in `ai/dist/index.js`),
// so a non-2xx from our own route handler (an ActionResult envelope's JSON)
// was rendering verbatim in the chat UI. Extracts the envelope's own
// `error.message` when present, otherwise a generic fallback.
export function chatErrorMessage(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { ok?: boolean; error?: { message?: string } };
    if (parsed.ok === false && typeof parsed.error?.message === "string") {
      return parsed.error.message;
    }
  } catch {
    // Not JSON — fall through to the generic message below.
  }
  return "Something went wrong. Please try again.";
}
