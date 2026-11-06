"use server";

// X02-T7 — certificate.issue. Thin RPC wrapper over public.issue_certificate
// (0091, T3): the definer already raises code:unauthenticated/forbidden/
// not_found/validation_failed/invalid_state (mapped by mapSqlError below)
// and writes its own audit row (certificate.issued), so no extra handling
// or TS-side audit here (lifecycle/actions.ts precedent). Ruling adds two
// raw-code mappings the definer can't express as `code:*`: a concurrent
// serial collision surfaces as a raw 23505 (-> conflict), and the RLS/role
// re-check inside the definer can surface as a raw 42501 (-> forbidden).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { IssueCertificateSchema, type IssueCertificateInput } from "@/modules/certificates/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === POSTGRES_UNIQUE_VIOLATION) {
    throw new AppError("conflict", "That certificate could not be issued — try again.");
  }
  if (code === POSTGRES_RLS_VIOLATION) {
    throw new AppError("forbidden", "You do not have permission to perform this action.");
  }
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** `issue_certificate` returns jsonb — the generated `Json` type carries no field names; narrow once at the boundary (lifecycle/actions.ts's asJsonRecord precedent). */
function asJsonRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new AppError("internal", "Unexpected response shape.");
  }
  return data as Record<string, unknown>;
}

export const issueCertificate = defineAction({
  name: "certificate.issue",
  module: "certificates",
  schema: IssueCertificateSchema,
  permission: "certificate.manage",
  handler: async (input: IssueCertificateInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("issue_certificate", {
      p_student_id: input.studentId,
      p_kind: input.kind,
      p_purpose: "purpose" in input ? input.purpose : undefined,
      p_conduct: "conduct" in input ? input.conduct : undefined,
    });
    if (error) throwMapped(error);

    const result = asJsonRecord(data);
    return {
      certificateId: result.certificate_id as string,
      serialNo: result.serial_no as string,
      created: result.created as boolean,
    };
  },
});
