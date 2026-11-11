// F18 §H — issue one platform invite code for /start.
//   pnpm invite:create --note "<school>" --email <owner email> [--uses n] [--days n]
//   pnpm invite:create --note "<school>" --unbound [--uses n] [--days n]
// Prints the code once; only its sha256 hex is stored (hash contract in
// supabase/migrations/20261028000127_school_setup.sql). The code is never
// logged anywhere else and cannot be recovered: lost codes are re-issued.
// --email binds the code to the owner's email (email_hash): /start creates the
// account already confirmed, so an unbound code lets its holder claim any address.
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createScriptAdminClient } from "./lib/admin-client.ts";

// Same normalisation as StartSchoolSchema.email (src/modules/core/setup/schemas.ts,
// not importable here: it uses `@/` aliases); SQL hashes lower(btrim(email)).
const OwnerEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

// Crockford base32 (no I, L, O, U): 20 random bytes = 160 bits = 32 chars,
// printed as 8 groups of 4. /start upper-cases what the owner types.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_SHAPE = /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/;

function generateCode(): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  const code = out.match(/.{4}/g)!.join("-");
  if (!CODE_SHAPE.test(code)) throw new Error("invite code generator produced an unexpected shape");
  return code;
}

function intFlag(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`--${name} must be a whole number from ${min} to ${max}.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const { values } = parseArgs({
    options: {
      note: { type: "string" },
      uses: { type: "string", default: "1" },
      days: { type: "string", default: "30" },
      email: { type: "string" },
      unbound: { type: "boolean", default: false },
    },
  });

  const note = values.note?.trim();
  if (!note || note.length > 200) {
    console.error('--note "<school name>" is required (at most 200 characters).');
    process.exit(1);
  }
  const maxUses = intFlag(values.uses, "uses", 1, 1000);
  const days = intFlag(values.days, "days", 1, 365);

  if (values.unbound === (values.email !== undefined)) {
    console.error("Give exactly one of --email <owner email> (the only address that can use the code) or --unbound.");
    process.exit(1);
  }
  const email = values.email === undefined ? null : OwnerEmail.safeParse(values.email);
  if (email && !email.success) {
    console.error("--email must be a valid email address.");
    process.exit(1);
  }
  const ownerEmail = email?.data ?? null;
  if (!ownerEmail) console.warn("WARNING: --unbound: anyone holding this code can claim any email address with it.");

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (service role). Refusing to run.");
    process.exit(1);
  }

  process.env.SERVICE_ROLE_CALLER = "invite";
  const admin = createScriptAdminClient();

  const code = generateCode();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("platform_invite_codes")
    .insert({
      code_hash: sha256Hex(code),
      email_hash: ownerEmail ? sha256Hex(ownerEmail) : null,
      note,
      max_uses: maxUses,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("invite code was not stored");

  console.log(`Invite code (shown once, store it safely): ${code}`);
  console.log(`Id ${data.id} · uses ${maxUses} · expires ${expiresAt}`);
  console.log(ownerEmail ? `Bound to ${ownerEmail}: only this email can use the code.` : "Unbound: any email can use the code.");
}

main().catch((err: unknown) => {
  // Never echo the code here: it is only printed after a successful insert.
  console.error("invite:create failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
