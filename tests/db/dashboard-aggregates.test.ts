import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { getAdmissionsFunnelCounts, listEnquiriesByStage } from "@/modules/admissions/queries";
import { buildContext, closeActionsHelper } from "../helpers/actions";
import { setActingClient } from "../helpers/server-client-mock";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// PostgREST caps one response at max_rows (1000): aggregates must stay exact above it.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 2 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("dashboard aggregates above the 1000-row API cap", () => {
  it("admissions funnel counts and the enquiry board are exact with 1,200 enquiries", async () => {
    const inst = await createTestInstitution("dash-agg-enquiries");
    try {
      await sql`
        insert into public.enquiries (institution_id, child_name, guardian_name, phone, status)
        select ${inst.institutionId}, 'Child ' || g, 'Guardian ' || g, '9' || lpad(g::text, 9, '0'),
               case when g <= 700 then 'new' else 'contacted' end
          from generate_series(1, 1200) g`;
      const ctx = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      const funnel = await getAdmissionsFunnelCounts(ctx);
      const board = await listEnquiriesByStage(ctx);
      setActingClient(null);

      expect(funnel.enquiryStages.new).toBe(700);
      expect(funnel.enquiryStages.contacted).toBe(500);
      expect(board.new).toHaveLength(700);
      expect(board.contacted).toHaveLength(500);
    } finally {
      await inst.cleanup();
    }
  });
});
