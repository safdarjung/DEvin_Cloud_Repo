"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";

const RequeueJobInput = z.object({ jobId: z.string().uuid() }).strict();

// Requeues a dead-lettered job (acceptance criterion 5): 'dead' -> 'queued'
// with attempts reset to 0. Security review fix (T-037): a raw `.update()`
// from any owner/principal/admin could rewrite `type`/`payload`/
// `max_attempts` on any job row (those columns later run with service-role
// privileges) — `jobs_update` (0003) was dropped and UPDATE revoked from
// `authenticated` entirely (20261028000012). The only tenant-side mutation
// now goes through `public.jobs_requeue`, a security-definer function that
// checks membership/role, only allows 'dead' -> 'queued', and writes the
// audit row itself (status+attempts only, never payload/last_error).
export const requeueJob = defineAction({
  name: "job.requeue",
  schema: RequeueJobInput,
  permission: "job.manage",
  handler: async ({ jobId }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("jobs_requeue", {
      p_institution_id: ctx.institution.id,
      p_id: jobId,
    });
    if (error) {
      const mapped = mapSqlError(error);
      if (mapped.ok) throw new AppError("internal", "Unexpected error.");
      throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
    }

    revalidatePath(`/${ctx.institution.slug}/jobs`);
    return { id: data.id };
  },
});
