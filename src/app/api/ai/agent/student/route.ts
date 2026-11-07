import "server-only";
// T4 (ai-roles) — delegates entirely to the shared chat kernel
// (`handleAiChat`): persona, tool scoping, and the local/cloud choice come
// from `ctx.membership.role`, never from this route path. See
// src/modules/ai/kernel/handle-chat.ts for the full request lifecycle.
import { handleAiChat } from "@/modules/ai/kernel/handle-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleAiChat(request);
}
