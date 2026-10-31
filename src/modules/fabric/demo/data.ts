import type { Connector, ConnectorSync, DataQualityScore, LineageNode, GraphEdge } from "@/modules/fabric/types";
import { rng, isoDate, addDays, type FixtureOpts } from "./prng";

const CONNECTOR_NAMES = [
  { slug: "tally-export", name: "Tally Export", provider: "Tally.ERP" },
  { slug: "razorpay-sim", name: "Razorpay (Simulated)", provider: "Razorpay" },
  { slug: "whatsapp-sim", name: "WhatsApp Business (Simulated)", provider: "Meta WhatsApp" },
  { slug: "google-ws", name: "Google Workspace", provider: "Google" },
  { slug: "bus-gps", name: "Bus GPS Tracking", provider: "Samsara" },
  { slug: "biometric", name: "Biometric Attendance", provider: "ZKTeco" },
  { slug: "cbse-import", name: "CBSE Portal File Import", provider: "CBSE" },
  { slug: "library-ils", name: "Library ILS", provider: "Koha" },
];

const CONNECTOR_KINDS = ["api", "webhook", "file", "read_only", "read_write"] as const;
type ConnectorStatus = "healthy" | "degraded" | "failed" | "disconnected";
type SyncStatus = "ok" | "partial" | "failed";

export function connectors(opts: FixtureOpts): Connector[] {
  const r = rng(opts.seed ?? 7);
  const now = new Date(opts.now);
  const result: Connector[] = [];

  for (let i = 0; i < CONNECTOR_NAMES.length; i++) {
    const def = CONNECTOR_NAMES[i];
    // Only the third connector (index 2) should be failed
    const status: ConnectorStatus = i === 2 ? "failed" : r.pick(["healthy", "degraded", "disconnected"] as const);
    const lastSyncDaysAgo = status === "failed" ? 7 : r.int(0, 3);

    result.push({
      id: r.id("conn", i),
      institution_id: opts.institutionId,
      slug: def.slug,
      name: def.name,
      kind: r.pick(CONNECTOR_KINDS),
      provider: def.provider,
      scopes: r.chance(0.6) ? ["read", "write"] : ["read"],
      status,
      last_sync_at: status === "disconnected" ? null : isoDate(addDays(now, -lastSyncDaysAgo)),
      records_synced: r.int(0, 10000),
      owner: r.pick(["admin@school.local", "data-team@school.local"]),
      created_at: isoDate(addDays(now, -r.int(30, 365))),
      updated_at: isoDate(addDays(now, -r.int(0, 7))),
    });
  }
  return result;
}

export function connectorSyncs(opts: FixtureOpts): ConnectorSync[] {
  const r = rng((opts.seed ?? 7) + 1000);
  const now = new Date(opts.now);
  const conns = connectors(opts);
  const result: ConnectorSync[] = [];

  // 20 syncs distributed over last 7 days
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = new Date(now.getTime() - sevenDaysMs);

  for (let i = 0; i < 20; i++) {
    const connectorIdx = i % conns.length;
    const connector = conns[connectorIdx];
    const randomMs = r.next() * sevenDaysMs;
    const startedAt = new Date(sevenDaysAgo.getTime() + randomMs);
    const durationMinutes = r.int(5, 120);
    const finishedAt = new Date(startedAt.getTime() + durationMinutes * 60000);

    const status: SyncStatus = connector.status === "failed" ? "failed" : r.pick(["ok", "partial", "failed"] as const);
    const records = status === "failed" ? 0 : r.int(10, 5000);

    result.push({
      id: r.id("sync", i),
      institution_id: opts.institutionId,
      connector_id: connector.id,
      started_at: isoDate(startedAt),
      finished_at: isoDate(finishedAt),
      status,
      records,
      errors: status === "ok" ? [] : [r.pick(["Timeout", "Auth failed", "Quota exceeded", "Schema mismatch"])],
      created_at: isoDate(startedAt),
      updated_at: isoDate(finishedAt),
    });
  }
  return result;
}

export function dataQualityScores(opts: FixtureOpts): DataQualityScore[] {
  const r = rng((opts.seed ?? 7) + 2000);
  const entities = ["students", "guardians", "staff", "attendance", "marks", "invoices", "timetable", "transport"];

  return entities.map((entity) => {
    const score = r.int(60, 100);
    const issues = [];

    if (r.chance(0.4)) {
      issues.push({ kind: "missing" as const, count: r.int(1, 50) });
    }
    if (r.chance(0.3)) {
      issues.push({ kind: "duplicate" as const, count: r.int(1, 20) });
    }
    if (r.chance(0.2)) {
      issues.push({ kind: "stale" as const, count: r.int(5, 100) });
    }
    if (r.chance(0.1)) {
      issues.push({ kind: "invalid" as const, count: r.int(1, 10) });
    }

    return { entity, score, issues };
  });
}

export function lineage(opts: FixtureOpts): { nodes: LineageNode[]; edges: GraphEdge[] } {
  const r = rng((opts.seed ?? 7) + 3000);
  const nodes: LineageNode[] = [];
  const edges: GraphEdge[] = [];

  // Create a deterministic lineage graph:
  // Sources -> Tables -> Metrics -> Reports/Widgets
  const sources = [
    "Tally",
    "Razorpay",
    "Google Workspace",
    "Bus GPS",
    "Biometric",
    "CBSE Portal",
    "Koha",
  ];

  const tables = [
    "invoices",
    "payments",
    "attendance",
    "marks",
    "staff",
    "students",
    "timetable",
    "routes",
  ];

  const metrics = [
    "fee_collected",
    "attendance_rate",
    "pass_rate",
    "avg_marks",
    "bus_capacity",
    "staff_load",
    "room_util",
  ];

  const reports = [
    "Finance Dashboard",
    "Attendance Report",
    "Academic Analytics",
    "Operational Insights",
    "Transport Monitoring",
    "Staff Workload",
  ];

  const colWidth = 220;
  let nodeId = 0;
  const nodeMap: Record<string, string> = {};

  // Sources (x: 0)
  sources.forEach((source, idx) => {
    const id = r.id("node", nodeId++);
    nodeMap[`source-${idx}`] = id;
    nodes.push({
      id,
      label: source,
      type: "source",
      x: 0,
      y: idx * 80 + 40,
    });
  });

  // Tables (x: colWidth)
  tables.forEach((table, idx) => {
    const id = r.id("node", nodeId++);
    nodeMap[`table-${idx}`] = id;
    nodes.push({
      id,
      label: table,
      type: "table",
      x: colWidth,
      y: idx * 50 + 60,
    });
  });

  // Metrics (x: 2 * colWidth)
  metrics.forEach((metric, idx) => {
    const id = r.id("node", nodeId++);
    nodeMap[`metric-${idx}`] = id;
    nodes.push({
      id,
      label: metric,
      type: "metric",
      x: 2 * colWidth,
      y: idx * 60 + 80,
    });
  });

  // Reports/Widgets (x: 3 * colWidth)
  reports.forEach((report, idx) => {
    const id = r.id("node", nodeId++);
    nodeMap[`report-${idx}`] = id;
    nodes.push({
      id,
      label: report,
      type: r.pick(["report", "widget"]),
      x: 3 * colWidth,
      y: idx * 70 + 100,
    });
  });

  // Source -> Table edges
  sources.forEach((_, srcIdx) => {
    const numConnections = r.int(1, 4);
    for (let i = 0; i < numConnections; i++) {
      const tableIdx = (srcIdx + i) % tables.length;
      edges.push({
        source: nodeMap[`source-${srcIdx}`],
        target: nodeMap[`table-${tableIdx}`],
      });
    }
  });

  // Table -> Metric edges
  tables.forEach((_, tableIdx) => {
    const numConnections = r.int(1, 3);
    for (let i = 0; i < numConnections; i++) {
      const metricIdx = (tableIdx + i) % metrics.length;
      edges.push({
        source: nodeMap[`table-${tableIdx}`],
        target: nodeMap[`metric-${metricIdx}`],
      });
    }
  });

  // Metric -> Report edges
  metrics.forEach((_, metricIdx) => {
    const numConnections = r.int(1, 3);
    for (let i = 0; i < numConnections; i++) {
      const reportIdx = (metricIdx + i) % reports.length;
      edges.push({
        source: nodeMap[`metric-${metricIdx}`],
        target: nodeMap[`report-${reportIdx}`],
      });
    }
  });

  return { nodes, edges };
}
