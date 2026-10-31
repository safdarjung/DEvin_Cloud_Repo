import { rng, FixtureOpts, isoDate, addDays } from "./prng";
import type {
  StudioRequest,
  StudioProposal,
  StudioResolution,
} from "../types";

export function studioRequests(opts: FixtureOpts): StudioRequest[] {
  const r = rng(opts.seed);
  const base = addDays(opts.now, -30);

  return [
    {
      id: r.id("req", 1),
      institution_id: opts.institutionId,
      created_at: isoDate(base),
      updated_at: isoDate(base),
      title: "Hostel leave approvals",
      problem: "Wardens manage hostel leaves on paper. No audit trail, double approvals happen.",
      desired_outcome: "Digital workflow: student request → warden → principal approval. Notify parents.",
      user_roles: ["warden", "principal", "parent"],
      existing_systems: ["Core", "notifications"],
      integrations: [],
      constraints: "Must work offline for approval lists.",
      budget_range: "under_50k",
      timeline: "1 month",
      success_criteria: "100% of leaves approved digitally by month-end.",
      status: "submitted",
      requested_by: "warden-001",
    },
    {
      id: r.id("req", 2),
      institution_id: opts.institutionId,
      created_at: isoDate(addDays(base, 3)),
      updated_at: isoDate(addDays(base, 3)),
      title: "Canteen prepaid cards",
      problem: "Students lose cash; no daily accounting of canteen sales.",
      desired_outcome: "Prepaid cards linked to students. Real-time sales tracking. Low balance alerts to parents.",
      user_roles: ["student", "parent", "canteen_manager"],
      existing_systems: ["finance", "messaging"],
      integrations: ["payment_gateway"],
      constraints: "Cards must work offline at canteen.",
      budget_range: "50k_2l",
      timeline: "2 months",
      success_criteria: "50 students on cards by month 2.",
      status: "proposed",
      requested_by: "principal-001",
    },
    {
      id: r.id("req", 3),
      institution_id: opts.institutionId,
      created_at: isoDate(addDays(base, 7)),
      updated_at: isoDate(addDays(base, 7)),
      title: "Alumni donations module",
      problem: "No way to collect funds from alumni. Manual email requests only.",
      desired_outcome: "Portal for alumni to browse school needs and donate. Tax receipts auto-generated.",
      user_roles: ["alumni", "principal", "accountant"],
      existing_systems: ["finance", "communication"],
      integrations: ["payment_processor", "tax_receipt_service"],
      constraints: "GST compliance required.",
      budget_range: "2l_10l",
      timeline: "3 months",
      success_criteria: "₹5L collected in first quarter.",
      status: "building",
      requested_by: "principal-001",
    },
    {
      id: r.id("req", 4),
      institution_id: opts.institutionId,
      created_at: isoDate(addDays(base, 14)),
      updated_at: isoDate(addDays(base, 14)),
      title: "Bus GPS and parent view",
      problem: "Parents don't know bus location or ETA. Transportation is black-box.",
      desired_outcome: "Real-time bus tracking map. Notifications when bus leaves school and approaches stop.",
      user_roles: ["driver", "parent", "transport_manager"],
      existing_systems: ["timetable"],
      integrations: ["gps_tracking_api"],
      constraints: "Live data under 30s latency.",
      budget_range: "50k_2l",
      timeline: "2 months",
      success_criteria: "100% of buses tracked; 95% parent adoption.",
      status: "delivered",
      requested_by: "transport-001",
    },
  ];
}

export function studioProposals(opts: FixtureOpts): StudioProposal[] {
  const r = rng((opts.seed ?? 7) + 100);
  const base = addDays(opts.now, -30);
  const requests = studioRequests(opts);

  return [
    {
      id: r.id("prop", 1),
      institution_id: opts.institutionId,
      created_at: isoDate(addDays(base, 1)),
      updated_at: isoDate(addDays(base, 1)),
      request_id: requests[0]!.id,
      version: 1,
      resolution: "new_module",
      interpretation: "Digital leave request and approval workflow tied to roles.",
      clarifying_questions: [
        "Should recurring leaves (e.g. weekends) auto-approve?",
        "Who can see leave history: parents only or all guardians?",
      ],
      features: ["Leave request form", "Role-based approvals", "Notification rules"],
      workflows: ["Request → Warden review → Principal approval"],
      ux_outline: [
        "Student initiates on mobile",
        "Warden sees queue on dashboard",
      ],
      technical_requirements: ["New table: leave_requests", "Workflow engine"],
      integration_requirements: [],
      permission_requirements: ["leave.request.create", "leave.approve"],
      cost_estimate_paise: 2500000,
      timeline_weeks: 4,
      risks: ["Parent notification delivery lag"],
      acceptance_criteria: ["95% approval response within 6 hours"],
      pipeline: [
        {
          stage: "research",
          status: "done",
        },
        {
          stage: "architect",
          status: "pending",
        },
        {
          stage: "code",
          status: "pending",
        },
        {
          stage: "test",
          status: "pending",
        },
        {
          stage: "security",
          status: "pending",
        },
        {
          stage: "review",
          status: "pending",
        },
        {
          stage: "deploy",
          status: "pending",
        },
      ],
      preview_html: null,
    },
    {
      id: r.id("prop", 2),
      institution_id: opts.institutionId,
      created_at: isoDate(addDays(base, 5)),
      updated_at: isoDate(addDays(base, 5)),
      request_id: requests[1]!.id,
      version: 1,
      resolution: "integration",
      interpretation: "Prepaid wallet system integrated with canteen POS and payment rails.",
      clarifying_questions: [
        "Card brand: custom or partner (e.g., RazorpayX)?",
        "Offline sync interval when connectivity lost?",
        "Min transaction for low-balance alert threshold?",
      ],
      features: ["Prepaid wallet", "Point-of-sale integration", "Parent top-up", "Analytics"],
      workflows: ["Parent loads card → Student uses at canteen → Real-time sync"],
      ux_outline: [
        "Parent: mobile wallet app",
        "Canteen: offline terminal",
        "Student: tap card",
      ],
      technical_requirements: [
        "PCI DSS compliance",
        "Offline sync queue",
        "Wallet ledger table",
      ],
      integration_requirements: ["Payment gateway API", "Canteen POS"],
      permission_requirements: ["finance.wallet.topup", "canteen.sales.record"],
      cost_estimate_paise: 7500000,
      timeline_weeks: 8,
      risks: ["Card supply chain delay", "Offline data conflict on sync"],
      acceptance_criteria: [
        "50+ cards deployed and tested",
        "Offline mode tested 2hr window",
      ],
      pipeline: [
        {
          stage: "research",
          status: "done",
        },
        {
          stage: "architect",
          status: "done",
        },
        {
          stage: "code",
          status: "running",
        },
        {
          stage: "test",
          status: "pending",
        },
        {
          stage: "security",
          status: "pending",
        },
        {
          stage: "review",
          status: "pending",
        },
        {
          stage: "deploy",
          status: "pending",
        },
      ],
      preview_html: null,
    },
    {
      id: r.id("prop", 3),
      institution_id: opts.institutionId,
      created_at: isoDate(addDays(base, 10)),
      updated_at: isoDate(addDays(base, 10)),
      request_id: requests[2]!.id,
      version: 1,
      resolution: "platform_change",
      interpretation: "New alumni engagement module with donation portal and tax receipt generation.",
      clarifying_questions: [
        "Donation categories: open input or preset buckets (e.g. sports, library)?",
        "Tax receipt format: PDF email or printed?",
      ],
      features: [
        "Alumni registry",
        "Donation form",
        "Tax receipt engine",
        "Impact reporting",
      ],
      workflows: [
        "Alumni logs in → Sees school needs → Donates → Receipt auto-sent",
      ],
      ux_outline: [
        "Dashboard: alumni dashboard with school impact cards",
        "Donation: multi-currency support",
      ],
      technical_requirements: [
        "New schema: alumni_profiles, donations, tax_receipts",
        "PDF generation service",
      ],
      integration_requirements: [
        "Payment processor (Stripe/Razorpay)",
        "Tax filing API",
      ],
      permission_requirements: ["alumni.view_dashboard", "finance.donation.record"],
      cost_estimate_paise: 15000000,
      timeline_weeks: 12,
      risks: ["Tax compliance across states", "Payment gateway multi-currency lag"],
      acceptance_criteria: [
        "First donation processed and receipt issued",
        "Tax audit trail complete",
      ],
      pipeline: [
        {
          stage: "research",
          status: "done",
        },
        {
          stage: "architect",
          status: "done",
        },
        {
          stage: "code",
          status: "running",
        },
        {
          stage: "test",
          status: "running",
        },
        {
          stage: "security",
          status: "pending",
        },
        {
          stage: "review",
          status: "pending",
        },
        {
          stage: "deploy",
          status: "pending",
        },
      ],
      preview_html: null,
    },
    {
      id: r.id("prop", 4),
      institution_id: opts.institutionId,
      created_at: isoDate(addDays(base, 15)),
      updated_at: isoDate(addDays(base, 15)),
      request_id: requests[3]!.id,
      version: 1,
      resolution: "integration",
      interpretation: "GPS tracking integration for all buses with live parent notification.",
      clarifying_questions: [],
      features: ["Bus tracking map", "Live ETA", "Arrival notifications", "Driver app"],
      workflows: ["Driver app streams location → Parent sees live map → Auto-notify"],
      ux_outline: [
        "Parent: map view with bus icon and ETA timer",
        "Driver: backgrounded location service",
      ],
      technical_requirements: ["WebSocket for live updates", "Geofence engine"],
      integration_requirements: ["GPS device API", "Maps provider"],
      permission_requirements: ["transport.view_live_location"],
      cost_estimate_paise: 5000000,
      timeline_weeks: 8,
      risks: ["Battery drain on driver phones"],
      acceptance_criteria: ["All buses tracked live at <30s latency"],
      pipeline: [
        {
          stage: "research",
          status: "done",
        },
        {
          stage: "architect",
          status: "done",
        },
        {
          stage: "code",
          status: "done",
        },
        {
          stage: "test",
          status: "done",
        },
        {
          stage: "security",
          status: "done",
        },
        {
          stage: "review",
          status: "done",
        },
        {
          stage: "deploy",
          status: "done",
        },
      ],
      preview_html: `<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: sans-serif; bg: #f5f5f5; padding: 16px; }
.header { display: flex; align-items: center; margin-bottom: 24px; }
.logo { width: 40px; height: 40px; background: #4F46E5; border-radius: 8px; margin-right: 12px; }
h1 { font-size: 20px; font-weight: 600; color: #1F2937; }
.map-container { width: 100%; height: 280px; background: linear-gradient(135deg, #E5E7EB 0%, #D1D5DB 100%); border-radius: 12px; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; }
.bus-marker { width: 48px; height: 48px; background: #10B981; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; }
.bus-info { background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px; }
.info-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
.label { color: #6B7280; font-weight: 500; }
.value { color: #1F2937; font-weight: 600; }
.eta { font-size: 32px; font-weight: 700; color: #10B981; text-align: center; margin: 12px 0; }
.stop-list { background: white; padding: 12px; border-radius: 8px; }
.stop { padding: 8px; border-bottom: 1px solid #E5E7EB; font-size: 13px; }
.stop:last-child { border-bottom: none; }
.stop-name { color: #1F2937; font-weight: 500; }
.stop-time { color: #9CA3AF; font-size: 12px; }
.route-name { color: #6B7280; font-size: 12px; margin-top: 4px; }
</style>
</head>
<body>
<div class="header">
  <div class="logo"></div>
  <h1>Bus Tracker</h1>
</div>
<div class="map-container">
  <div class="bus-marker">🚌</div>
</div>
<div class="bus-info">
  <div class="info-row">
    <span class="label">Route</span>
    <span class="value">West Loop 101</span>
  </div>
  <div class="info-row">
    <span class="label">Driver</span>
    <span class="value">Ravi Kumar</span>
  </div>
  <div class="info-row">
    <span class="label">Status</span>
    <span class="value" style="color: #10B981;">On Time</span>
  </div>
  <div class="eta">8 mins</div>
  <div class="info-row">
    <span class="label">Next Stop</span>
    <span class="value">Market Street</span>
  </div>
</div>
<div class="stop-list">
  <div class="stop">
    <div class="stop-name">Market Street</div>
    <div class="stop-time">08:15 — 2 students</div>
    <div class="route-name">West Loop 101</div>
  </div>
  <div class="stop">
    <div class="stop-name">Park Avenue</div>
    <div class="stop-time">08:28 — 4 students</div>
    <div class="route-name">West Loop 101</div>
  </div>
  <div class="stop">
    <div class="stop-name">Main Station</div>
    <div class="stop-time">08:42 — 3 students</div>
    <div class="route-name">West Loop 101</div>
  </div>
</div>
</body>
</html>`,
    },
  ];
}

export function interpretRequest(text: string): {
  resolution: StudioResolution;
  interpretation: string;
  questions: string[];
} {
  const lower = text.toLowerCase();
  let resolution: StudioResolution;

  if (lower.includes("report")) {
    resolution = "configuration";
  } else if (
    lower.includes("integrat") ||
    lower.includes("gps") ||
    lower.includes("payment")
  ) {
    resolution = "integration";
  } else {
    resolution = "new_module";
  }

  return {
    resolution,
    interpretation: `Analyzed request suggests a ${resolution} approach.`,
    questions: [
      "What is the primary user role that needs this?",
      "Is this critical for day-to-day operations?",
    ],
  };
}
