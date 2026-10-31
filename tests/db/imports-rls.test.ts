import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("imports migration (0066) RLS", () => {
  it("admin inserts a batch + rows into their own institution", async () => {
    const inst = await createTestInstitution("imports-admin");
    try {
      const { data: batch, error: batchError } = await inst
        .clientAs("admin")
        .from("import_batches")
        .insert({ institution_id: inst.institutionId, entity_type: "students", file_name: "students.csv" })
        .select("id")
        .single();
      expect(batchError).toBeNull();

      const { error: rowError } = await inst
        .clientAs("admin")
        .from("import_rows")
        .insert({
          batch_id: batch!.id,
          institution_id: inst.institutionId,
          row_no: 2,
          data: { admission_no: "ADM-1" },
          status: "valid",
        });
      expect(rowError).toBeNull();

      const { data: rows } = await inst.clientAs("admin").from("import_rows").select("id").eq("batch_id", batch!.id);
      expect(rows).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot read or insert import_batches/import_rows", async () => {
    const inst = await createTestInstitution("imports-teacher");
    try {
      const [batch] = await sql`
        insert into public.import_batches (institution_id, entity_type, file_name)
        values (${inst.institutionId}, 'students', 'students.csv')
        returning id
      `;

      const { data: selectRows, error: selectError } = await inst
        .clientAs("teacher")
        .from("import_batches")
        .select("id");
      expect(selectError).toBeNull();
      expect(selectRows).toHaveLength(0);

      const { error: insertError } = await inst
        .clientAs("teacher")
        .from("import_batches")
        .insert({ institution_id: inst.institutionId, entity_type: "students", file_name: "x.csv" });
      expect(insertError).not.toBeNull();

      const { error: rowInsertError } = await inst
        .clientAs("teacher")
        .from("import_rows")
        .insert({ batch_id: batch.id, institution_id: inst.institutionId, row_no: 1, data: {}, status: "valid" });
      expect(rowInsertError).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("admissions cannot read or insert import_batches", async () => {
    const inst = await createTestInstitution("imports-admissions");
    try {
      const { data: selectRows, error: selectError } = await inst
        .clientAs("admissions")
        .from("import_batches")
        .select("id");
      expect(selectError).toBeNull();
      expect(selectRows).toHaveLength(0);

      const { error: insertError } = await inst
        .clientAs("admissions")
        .from("import_batches")
        .insert({ institution_id: inst.institutionId, entity_type: "students", file_name: "x.csv" });
      expect(insertError).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian sees no import_batches or import_rows", async () => {
    const inst = await createTestInstitution("imports-guardian");
    try {
      await sql`
        insert into public.import_batches (institution_id, entity_type, file_name)
        values (${inst.institutionId}, 'students', 'students.csv')
      `;

      const { data: batches, error } = await inst.clientAs("guardian").from("import_batches").select("id");
      expect(error).toBeNull();
      expect(batches).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of institution A cannot add a row to institution B's batch", async () => {
    await withTwoInstitutions(async (a, b) => {
      const [batchB] = await sql`
        insert into public.import_batches (institution_id, entity_type, file_name)
        values (${b.institutionId}, 'students', 'students.csv')
        returning id
      `;

      const { error } = await a
        .clientAs("admin")
        .from("import_rows")
        .insert({
          batch_id: batchB.id,
          institution_id: a.institutionId,
          row_no: 1,
          data: { admission_no: "ADM-X" },
          status: "valid",
        });
      expect(error).not.toBeNull();

      const rowsInB = await sql`select id from public.import_rows where batch_id = ${batchB.id}`;
      expect(rowsInB).toHaveLength(0);
    });
  });
});
