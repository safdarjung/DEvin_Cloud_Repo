// Side-effect imports registering every defineQuery() with the query
// registry (mirrors src/app/api/v1/actions/all-actions.ts for the actions
// namespace). The HTTP dispatcher imports this so every query is
// registered before lookup.
// every query-defs file must be imported here
import "@/modules/academics/query-defs";
import "@/modules/admissions/query-defs";
import "@/modules/ai/query-defs";
import "@/modules/ai/student-study-query-defs";
import "@/modules/attendance/query-defs";
import "@/modules/core/query-defs";
import "@/modules/exams/query-defs";
import "@/modules/finance/query-defs";
import "@/modules/jobs/query-defs";
import "@/modules/notifications/query-defs";
import "@/modules/people/query-defs";
import "@/modules/website/query-defs";
