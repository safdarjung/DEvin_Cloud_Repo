import { ChangeImpact, Id, TwinEdge, TwinNode, TwinSnapshot } from "@/modules/fabric/types";
import { FixtureOpts, isoDate, rng } from "@/modules/fabric/demo/prng";

export function twinSnapshot(opts: FixtureOpts, state: "historical" | "current" | "scenario"): TwinSnapshot {
  const r = rng(opts.seed ?? 7);
  const institution_id = opts.institutionId;
  const now = opts.now;

  const nodes: TwinNode[] = [];
  const nodeMap = new Map<string, TwinNode>();
  let colIndex = 0;
  let nodeCount = 0;

  // 2 buildings
  for (let i = 0; i < 2; i++) {
    const id = r.id("building", nodeCount++);
    nodes.push({ id, type: "building", label: `Building ${i + 1}`, x: colIndex * 220, y: 0 });
    nodeMap.set(id, nodes[nodes.length - 1]!);
  }
  colIndex++;

  // 6 departments
  for (let i = 0; i < 6; i++) {
    const id = r.id("department", nodeCount++);
    nodes.push({ id, type: "department", label: `Dept ${i + 1}`, x: colIndex * 220, y: (i % 6) * 90 });
    nodeMap.set(id, nodes[nodes.length - 1]!);
  }
  colIndex++;

  // 20 rooms
  const rooms: TwinNode[] = [];
  for (let i = 0; i < 20; i++) {
    const id = r.id("room", nodeCount++);
    const isScenariumOverload = state === "scenario" && (i === 0 || i === 1);
    const capacity = isScenariumOverload ? 25 + r.int(0, 10) : 30 + r.int(10, 40);
    const baseLoad = state === "historical" ? r.int(10, 25) : state === "current" ? r.int(15, 28) : r.int(18, 31);
    const load =
      state === "scenario" && i === 0
        ? baseLoad + 40
        : state === "scenario" && i === 1
          ? baseLoad + 35
          : baseLoad;
    const utilisation_pct = Math.round((load / capacity) * 100);
    const node: TwinNode = {
      id,
      type: "room",
      label: `Room ${i + 1}`,
      capacity,
      load,
      utilisation_pct,
      x: colIndex * 220,
      y: (i % 20) * 90,
    };
    nodes.push(node);
    rooms.push(node);
    nodeMap.set(id, node);
  }
  colIndex++;

  // 5 routes
  const routes: TwinNode[] = [];
  for (let i = 0; i < 5; i++) {
    const id = r.id("route", nodeCount++);
    const capacity = 40 + r.int(10, 20);
    const load = state === "historical" ? r.int(20, 32) : state === "current" ? r.int(25, 35) : r.int(28, 38);
    const utilisation_pct = Math.round((load / capacity) * 100);
    routes.push({ id, type: "route", label: `Route ${i + 1}`, capacity, load, utilisation_pct, x: colIndex * 220, y: i * 90 });
    nodeMap.set(id, routes[routes.length - 1]!);
    nodes.push(routes[routes.length - 1]!);
  }
  colIndex++;

  // 5 vehicles
  for (let i = 0; i < 5; i++) {
    const id = r.id("vehicle", nodeCount++);
    nodes.push({ id, type: "vehicle", label: `Vehicle ${i + 1}`, x: colIndex * 220, y: i * 90 });
    nodeMap.set(id, nodes[nodes.length - 1]!);
  }
  colIndex++;

  // 4 budget_line
  for (let i = 0; i < 4; i++) {
    const id = r.id("budget_line", nodeCount++);
    nodes.push({ id, type: "budget_line", label: `Budget ${i + 1}`, x: colIndex * 220, y: i * 90 });
    nodeMap.set(id, nodes[nodes.length - 1]!);
  }
  colIndex++;

  // 4 workflow
  for (let i = 0; i < 4; i++) {
    const id = r.id("workflow", nodeCount++);
    nodes.push({ id, type: "workflow", label: `Workflow ${i + 1}`, x: colIndex * 220, y: i * 90 });
    nodeMap.set(id, nodes[nodes.length - 1]!);
  }
  colIndex++;

  // 20 teachers
  const teachers: TwinNode[] = [];
  for (let i = 0; i < 20; i++) {
    const id = r.id("teacher", nodeCount++);
    teachers.push({ id, type: "teacher", label: `Teacher ${i + 1}`, x: colIndex * 220, y: (i % 20) * 90 });
    nodeMap.set(id, teachers[teachers.length - 1]!);
    nodes.push(teachers[teachers.length - 1]!);
  }
  colIndex++;

  // 12 student_group
  const groups: TwinNode[] = [];
  for (let i = 0; i < 12; i++) {
    const id = r.id("student_group", nodeCount++);
    const capacity = 30 + r.int(5, 20);
    const load = state === "historical" ? r.int(18, 27) : state === "current" ? r.int(22, 29) : r.int(24, 32);
    const utilisation_pct = Math.round((load / capacity) * 100);
    groups.push({
      id,
      type: "student_group",
      label: `Group ${i + 1}`,
      capacity,
      load,
      utilisation_pct,
      x: colIndex * 220,
      y: (i % 12) * 90,
    });
    nodeMap.set(id, groups[groups.length - 1]!);
    nodes.push(groups[groups.length - 1]!);
  }

  // Edges
  const edges: TwinEdge[] = [];
  const usedEdges = new Set<string>();

  // teaches: 20 teachers -> 12 groups (each teacher teaches 1-2 groups)
  for (const teacher of teachers) {
    const groupCount = r.int(1, 2);
    for (let i = 0; i < groupCount; i++) {
      const group = r.pick(groups);
      const key = `${teacher.id}→${group.id}`;
      if (!usedEdges.has(key)) {
        edges.push({ source: teacher.id, target: group.id, relation: "teaches", weight: r.int(1, 3) });
        usedEdges.add(key);
      }
    }
  }

  // uses: groups -> rooms (each group uses 2-3 rooms)
  for (const group of groups) {
    const roomCount = r.int(2, 3);
    for (let i = 0; i < roomCount; i++) {
      const room = r.pick(rooms);
      const key = `${group.id}→${room.id}`;
      if (!usedEdges.has(key)) {
        edges.push({ source: group.id, target: room.id, relation: "uses" });
        usedEdges.add(key);
      }
    }
  }

  // belongs_to: groups -> 6 departments, rooms -> 2 buildings, routes -> 5 vehicles
  for (const group of groups) {
    const deptId = r.pick(Array.from(nodeMap.values()).filter((n) => n.type === "department")).id;
    const key = `${group.id}→${deptId}`;
    if (!usedEdges.has(key)) {
      edges.push({ source: group.id, target: deptId, relation: "belongs_to" });
      usedEdges.add(key);
    }
  }

  for (const room of rooms) {
    const buildId = r.pick(Array.from(nodeMap.values()).filter((n) => n.type === "building")).id;
    const key = `${room.id}→${buildId}`;
    if (!usedEdges.has(key)) {
      edges.push({ source: room.id, target: buildId, relation: "belongs_to" });
      usedEdges.add(key);
    }
  }

  // transports: routes -> groups (each route transports 1-2 groups)
  for (const route of routes) {
    const groupCount = r.int(1, 2);
    for (let i = 0; i < groupCount; i++) {
      const group = r.pick(groups);
      const key = `${route.id}→${group.id}`;
      if (!usedEdges.has(key)) {
        edges.push({ source: route.id, target: group.id, relation: "transports" });
        usedEdges.add(key);
      }
    }
  }

  // depends_on: workflows depend on teachers (each workflow depends on 1-2 teachers)
  for (const workflow of Array.from(nodeMap.values()).filter((n) => n.type === "workflow")) {
    const teacherCount = r.int(1, 2);
    for (let i = 0; i < teacherCount; i++) {
      const teacher = r.pick(teachers);
      const key = `${workflow.id}→${teacher.id}`;
      if (!usedEdges.has(key)) {
        edges.push({ source: workflow.id, target: teacher.id, relation: "depends_on" });
        usedEdges.add(key);
      }
    }
  }

  // funds: budget_lines -> departments (each budget line funds 1-2 departments)
  for (const budgetLine of Array.from(nodeMap.values()).filter((n) => n.type === "budget_line")) {
    const deptCount = r.int(1, 2);
    for (let i = 0; i < deptCount; i++) {
      const dept = r.pick(Array.from(nodeMap.values()).filter((n) => n.type === "department"));
      const key = `${budgetLine.id}→${dept.id}`;
      if (!usedEdges.has(key)) {
        edges.push({ source: budgetLine.id, target: dept.id, relation: "funds" });
        usedEdges.add(key);
      }
    }
  }

  return {
    id: r.id("snapshot", 0),
    institution_id,
    created_at: isoDate(now),
    updated_at: isoDate(now),
    as_of: isoDate(now),
    state,
    scenario_id: state === "scenario" ? r.id("scenario", 1) : null,
    nodes,
    edges,
  };
}

export function changeImpact(snapshot: TwinSnapshot, nodeId: Id): ChangeImpact {
  const node = snapshot.nodes.find((n) => n.id === nodeId);
  if (!node) return { changed_node_id: nodeId, affected: [] };

  const affected: Map<Id, { effect: string; severity: string }> = new Map();
  const visited = new Set<Id>();
  const queue: { nodeId: Id; hop: number }[] = [{ nodeId, hop: 0 }];
  visited.add(nodeId);

  while (queue.length > 0) {
    const { nodeId: current, hop } = queue.shift()!;
    if (hop > 2) continue;

    // Find edges from this node
    const outgoing = snapshot.edges.filter((e) => e.source === current);
    const incoming = snapshot.edges.filter((e) => e.target === current);

    for (const edge of [...outgoing, ...incoming]) {
      const nextId = edge.source === current ? edge.target : edge.source;
      const nextNode = snapshot.nodes.find((n) => n.id === nextId);
      if (!nextNode || visited.has(nextId)) continue;

      visited.add(nextId);
      const severity = hop === 1 ? "warning" : "info";

      let effectText = "";
      if (edge.source === current) {
        effectText = `${node!.type} affects ${nextNode.type} via ${edge.relation}`;
      } else {
        effectText = `${nextNode.type} affects ${node!.type} via ${edge.relation}`;
      }

      affected.set(nextId, { effect: effectText, severity });

      if (hop < 2) {
        queue.push({ nodeId: nextId, hop: hop + 1 });
      }
    }
  }

  return {
    changed_node_id: nodeId,
    affected: Array.from(affected.entries()).map(([id, { effect, severity }]) => ({
      node_id: id,
      effect: effect.slice(0, 120),
      severity: severity as "info" | "watch" | "warning" | "critical",
    })),
  };
}
