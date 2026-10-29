import { createHash } from "node:crypto";

// Fixed namespace for every seed-generated id (RFC 4122 v5: namespace +
// name -> deterministic UUID). Never change this value — doing so changes
// every id the seed produces on the next reset. Just 32 hex characters
// used as namespace bytes; it doesn't need to be a "real" UUID itself.
const SEED_NAMESPACE = "c0315ee69b1e5f1a8f2e0a1b2c3d4e5f";

export function uuidV5(section: string, naturalKey: string): string {
  const namespaceBytes = Buffer.from(SEED_NAMESPACE, "hex");
  const nameBytes = Buffer.from(`${section}:${naturalKey}`, "utf8");
  const hash = createHash("sha1").update(Buffer.concat([namespaceBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));

  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
