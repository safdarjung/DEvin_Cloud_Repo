// Client POST helper for the draft-only /api/ai/* task routes (features-18 §C2):
// returns the route's data or one readable message, same wording as
// EnquiryReplyDraft's error mapping.
export type AiTaskResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface AiProviderMeta {
  provider: "local" | "cloud";
  model: string;
  fallback: boolean;
}

function messageFor(error: { code?: string; message?: string } | undefined): string {
  switch (error?.code) {
    case "ai_unavailable":
      return "AI is unavailable right now; try again or write it yourself.";
    case "ai_invalid_output":
      return "Could not produce a valid draft; try again, or describe it more clearly.";
    default:
      return error?.message ?? "Something went wrong; try again.";
  }
}

export async function postAiTask<T>(path: string, body: unknown): Promise<AiTaskResult<T>> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as { ok?: boolean; data?: T; error?: { code?: string; message?: string } };
    return json.ok ? { ok: true, data: json.data as T } : { ok: false, message: messageFor(json.error) };
  } catch {
    return { ok: false, message: "Could not reach the server; check your connection and try again." };
  }
}
