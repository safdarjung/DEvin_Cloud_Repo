import type { SeedContext } from "../lib/context.ts";

// Features-18 #14 — alumni profiles for students ALREADY graduated through the
// lifecycle owner (status 'alumni' + a 'graduated' event). The demo seed has no
// lifecycle helpers and this section never invents students or events, so on the
// demo tenant it inserts 0 rows and /alumni shows its empty state until a school
// runs promote_students + "Sync from graduated students". Service-role insert
// mirrors public.sync_alumni (0123) with deterministic placeholder contacts.
const CITIES = ["Pune", "Mumbai", "Delhi", "Bengaluru", "Hyderabad"] as const;
const JOBS = ["Software engineer", "Doctor", "Chartered accountant", "Teacher", "Entrepreneur"] as const;

export async function run(ctx: SeedContext): Promise<void> {
  const rows = await ctx.sql`
    insert into public.alumni_profiles (institution_id, student_id, batch_year, city, occupation)
    select s.institution_id, s.id, extract(year from max(ev.effective_on))::smallint,
           (${CITIES as unknown as string[]}::text[])[1 + (row_number() over (order by s.admission_no))::int % ${CITIES.length}],
           (${JOBS as unknown as string[]}::text[])[1 + (row_number() over (order by s.admission_no))::int % ${JOBS.length}]
    from public.students s
    join public.student_lifecycle_events ev on ev.student_id = s.id and ev.institution_id = s.institution_id and ev.kind = 'graduated'
    where s.institution_id = ${ctx.institutionId} and s.status = 'alumni'
    group by s.institution_id, s.id, s.admission_no
    on conflict (student_id) do nothing
    returning id
  `;
  console.log(`  alumni: ${rows.length} profile(s) (demo has no graduated students unless lifecycle ran)`);
}
