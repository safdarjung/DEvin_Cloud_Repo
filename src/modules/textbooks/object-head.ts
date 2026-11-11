import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { MAGIC_PREFIX_BYTES } from "./file-check";

type Client = Awaited<ReturnType<typeof createClient>>;

/** First bytes of a stored tenant-docs object through a short signed URL (caller's own access); null when missing. */
export async function objectHead(supabase: Client, path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from("tenant-docs").createSignedUrl(path, 30);
  if (error || !data) return null;
  const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${MAGIC_PREFIX_BYTES - 1}` }, cache: "no-store" });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer()).slice(0, MAGIC_PREFIX_BYTES);
}
