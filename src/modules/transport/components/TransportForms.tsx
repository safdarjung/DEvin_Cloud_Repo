"use client";

// Transport controls. Hiding them is UX only: actions re-check transport.manage and the Zod schema.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { humanize } from "@/lib/format";
import { assignTransport, unassignTransport, upsertRoute, upsertStop, upsertVehicle } from "@/modules/transport/actions";
import { ROUTE_STATUSES, VEHICLE_STATUSES } from "@/modules/transport/schemas";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";

type Result = { ok: true } | { ok: false; error: Parameters<typeof describeActionError>[0] };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Result>, success: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(describeActionError(res.error));
    });
  }
  return { pending, run };
}

export interface VehicleOption {
  id: string;
  label: string;
}

export function RouteForm({
  institutionSlug,
  route,
  vehicles,
}: {
  institutionSlug: string;
  route?: { id: string; name: string; status: (typeof ROUTE_STATUSES)[number]; vehicleId: string | null };
  vehicles: VehicleOption[];
}) {
  const { pending, run } = useRun();
  const [name, setName] = useState(route?.name ?? "");
  const [status, setStatus] = useState<(typeof ROUTE_STATUSES)[number]>(route?.status ?? "on_time");
  const [vehicleId, setVehicleId] = useState(route?.vehicleId ?? "");
  const id = route?.id ?? "new";
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => upsertRoute(institutionSlug, { id: route?.id, name, status, vehicleId: vehicleId || null }), route ? "Route updated" : "Route added", () => !route && setName(""));
      }}
    >
      <div>
        <Label htmlFor={`rn-${id}`}>Route name</Label>
        <Input id={`rn-${id}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="w-48" />
      </div>
      <div>
        <Label htmlFor={`rs-${id}`}>Status</Label>
        <select id={`rs-${id}`} className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {ROUTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`rv-${id}`}>Vehicle</Label>
        <select id={`rv-${id}`} className={SELECT_CLASS} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">No vehicle</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" disabled={pending || !name.trim()}>
        {route ? "Save" : "Add route"}
      </Button>
    </form>
  );
}

export function StopForm({ institutionSlug, routes }: { institutionSlug: string; routes: { id: string; name: string; stopCount: number }[] }) {
  const { pending, run } = useRun();
  const [routeId, setRouteId] = useState("");
  const [name, setName] = useState("");
  const [eta, setEta] = useState("07:30");
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        // shortcut: map position defaults to the centre; no map editor yet.
        run(() => upsertStop(institutionSlug, { routeId, seq: (routes.find((r) => r.id === routeId)?.stopCount ?? 0) + 1, name, eta, mapX: 50, mapY: 50 }), "Stop added", () => setName(""));
      }}
    >
      <div>
        <Label htmlFor="st-route">Route</Label>
        <select id="st-route" className={SELECT_CLASS} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
          <option value="">Choose route</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="st-name">Stop name</Label>
        <Input id="st-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="w-48" />
      </div>
      <div>
        <Label htmlFor="st-eta">Pickup time</Label>
        <Input id="st-eta" type="time" value={eta} onChange={(e) => setEta(e.target.value)} className="w-32" />
      </div>
      <Button type="submit" size="sm" disabled={pending || !routeId || !name.trim() || !eta}>
        Add stop
      </Button>
    </form>
  );
}

export function UnassignButton({ institutionSlug, studentId, studentName }: { institutionSlug: string; studentId: string; studentName: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Remove ${studentName} from transport`}
      onClick={() => run(() => unassignTransport(institutionSlug, { studentId }), "Transport removed")}
    >
      Unassign
    </Button>
  );
}

export function VehicleForm({
  institutionSlug,
  vehicle,
}: {
  institutionSlug: string;
  vehicle?: { id: string; registrationNo: string; capacity: number; driverName: string; status: (typeof VEHICLE_STATUSES)[number] };
}) {
  const { pending, run } = useRun();
  const [registrationNo, setRegistrationNo] = useState(vehicle?.registrationNo ?? "");
  const [capacity, setCapacity] = useState(String(vehicle?.capacity ?? ""));
  const [driverName, setDriverName] = useState(vehicle?.driverName ?? "");
  const [status, setStatus] = useState<(typeof VEHICLE_STATUSES)[number]>(vehicle?.status ?? "active");
  const id = vehicle?.id ?? "new";
  const seats = Number(capacity);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => upsertVehicle(institutionSlug, { id: vehicle?.id, registrationNo, capacity: seats, driverName, status }),
          vehicle ? "Vehicle updated" : "Vehicle added",
          () => {
            if (vehicle) return;
            setRegistrationNo("");
            setCapacity("");
            setDriverName("");
          },
        );
      }}
    >
      <div>
        <Label htmlFor={`vr-${id}`}>Registration no.</Label>
        <Input id={`vr-${id}`} value={registrationNo} maxLength={20} onChange={(e) => setRegistrationNo(e.target.value)} className="w-40" />
      </div>
      <div>
        <Label htmlFor={`vc-${id}`}>Seats</Label>
        <Input id={`vc-${id}`} type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(e.target.value)} className="w-24" />
      </div>
      <div>
        <Label htmlFor={`vd-${id}`}>Driver</Label>
        <Input id={`vd-${id}`} value={driverName} maxLength={80} onChange={(e) => setDriverName(e.target.value)} className="w-44" />
      </div>
      <div>
        <Label htmlFor={`vs-${id}`}>Status</Label>
        <select id={`vs-${id}`} className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {VEHICLE_STATUSES.map((st) => (
            <option key={st} value={st}>
              {humanize(st)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" disabled={pending || !registrationNo.trim() || !driverName.trim() || !Number.isInteger(seats) || seats < 1}>
        {vehicle ? "Save" : "Add vehicle"}
      </Button>
    </form>
  );
}

export interface StopOption {
  id: string;
  routeId: string;
  seq: number;
  name: string;
  eta: string;
  x: number;
  y: number;
}

export function EditStopForm({ institutionSlug, stop }: { institutionSlug: string; stop: StopOption }) {
  const { pending, run } = useRun();
  const [name, setName] = useState(stop.name);
  const [eta, setEta] = useState(stop.eta);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => upsertStop(institutionSlug, { id: stop.id, routeId: stop.routeId, seq: stop.seq, name, eta, mapX: stop.x, mapY: stop.y }), "Stop updated");
      }}
    >
      <Input aria-label={`Name of stop ${stop.seq}`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="h-8 w-40" />
      <Input aria-label={`Pickup time of stop ${stop.seq}`} type="time" value={eta} onChange={(e) => setEta(e.target.value)} className="h-8 w-28" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim() || !eta}>
        Save
      </Button>
    </form>
  );
}

export function AssignStopForm({ institutionSlug, studentId, studentName, stops }: { institutionSlug: string; studentId: string; studentName: string; stops: { id: string; label: string }[] }) {
  const { pending, run } = useRun();
  const [stopId, setStopId] = useState("");
  return (
    <form
      className="flex flex-wrap items-center justify-end gap-2"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => assignTransport(institutionSlug, { studentId, stopId }), "Transport assigned", () => setStopId(""));
      }}
    >
      <select aria-label={`Stop for ${studentName}`} className={SELECT_CLASS} value={stopId} onChange={(e) => setStopId(e.target.value)}>
        <option value="">Choose stop</option>
        {stops.map((st) => (
          <option key={st.id} value={st.id}>
            {st.label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending || !stopId}>
        Assign
      </Button>
    </form>
  );
}
