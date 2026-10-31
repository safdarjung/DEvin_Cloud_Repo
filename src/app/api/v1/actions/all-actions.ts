// Side-effect imports registering every defineAction() with the dispatcher
// (same module list as tests/security/escalation.test.ts). The HTTP
// dispatcher imports this so every action is registered before lookup.
// every new action file must be imported here
import "@/modules/academics/assignments.actions";
import "@/modules/admissions/actions";
import "@/modules/ai/student-study.actions";
import "@/modules/attendance/actions";
import "@/modules/core/actions";
import "@/modules/exams/actions";
import "@/modules/finance/actions";
import "@/modules/jobs/actions";
import "@/modules/notifications/actions";
import "@/modules/website/actions";
