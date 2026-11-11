import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

// F18 §H — a school is created only with an invite code (0127 revoked
// create_institution from `authenticated`). Mints a platform_invite_codes row
// the way scripts/invite-create.ts does: only the sha256 hex of the code is
// stored. Upper-case like the real codes (/start upper-cases what it gets).
// `email` binds the code like `invite-create.ts --email` (email_hash = sha256
// of the trimmed, lower-cased address); omitted = unbound (`--unbound`).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 2 });
const mintedIds: string[] = [];

export interface MintOptions {
  maxUses?: number;
  usedCount?: number;
  expiresAt?: Date;
  revoked?: boolean;
  email?: string;
}

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

export async function mintInviteCode(opts: MintOptions = {}): Promise<string> {
  const code = `TEST-${randomBytes(16).toString("hex").toUpperCase()}`;
  const [row] = await sql`
    insert into public.platform_invite_codes (code_hash, email_hash, note, max_uses, used_count, expires_at, revoked_at)
    values (
      ${sha256Hex(code)},
      ${opts.email === undefined ? null : sha256Hex(opts.email.trim().toLowerCase())},
      'test fixture',
      ${opts.maxUses ?? 1},
      ${opts.usedCount ?? 0},
      ${opts.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000)},
      ${opts.revoked ? new Date() : null}
    )
    returning id
  `;
  mintedIds.push(row.id as string);
  return code;
}

/** Deletes only the codes this process minted (and their redemption rows). */
export async function closeInviteCodesHelper(): Promise<void> {
  if (mintedIds.length > 0) {
    await sql`delete from public.platform_invite_redemptions where invite_code_id in ${sql(mintedIds)}`;
    await sql`delete from public.platform_invite_codes where id in ${sql(mintedIds)}`;
  }
  await sql.end();
}
