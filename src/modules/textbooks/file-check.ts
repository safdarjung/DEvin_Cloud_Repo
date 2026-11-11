// Server-side content check for an uploaded file: its first bytes must match
// the declared type. The bucket's allowed_mime_types only checks the
// Content-Type the uploader sent, so this is the check on the bytes.
const MAGIC: Readonly<Record<string, readonly number[]>> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

/** Bytes to read from the start of an object to run `matchesMagic`. */
export const MAGIC_PREFIX_BYTES = 8;

export function matchesMagic(mime: string, head: Uint8Array): boolean {
  const magic = MAGIC[mime];
  if (!magic || head.length < magic.length) return false;
  return magic.every((byte, i) => head[i] === byte);
}
