// Side-effect imports registering every defineQuery() with the query
// registry (mirrors src/app/api/v1/actions/all-actions.ts for the actions
// namespace). The HTTP dispatcher imports this so every query is
// registered before lookup.
// every query-defs file must be imported here
import "@/modules/academics/query-defs";
import "@/modules/people/query-defs";
