/**
 * Pose maths for the shared person rig. Pure numbers, no three.js: every action writes joint angles
 * (radians) into a pose; Person.tsx eases the real joints toward them.
 *
 * Conventions: the figure faces +z, its right arm is at -x, limbs hang along -y.
 * Shoulder/hip x < 0 swings the limb forward; right shoulder z < 0 (left z > 0) lifts the arm out sideways.
 * Elbow and knee are hinges about x (elbow < 0 bends the forearm forward, knee > 0 bends the shin back).
 */
export interface Pose {
  /** Pelvis: sideways shift and bob (metres), roll. */
  hipX: number;
  hipY: number;
  hipRoll: number;
  /** Spine: forward lean (x), turn (y), side sway (z). */
  lean: number;
  turn: number;
  sway: number;
  /** Head, on top of pointer tracking. `gaze` 0..1 = how much the head follows the pointer. */
  headYaw: number;
  headPitch: number;
  headRoll: number;
  gaze: number;
  rSx: number;
  rSz: number;
  rEx: number;
  rEz: number;
  rWx: number;
  rWz: number;
  lSx: number;
  lSz: number;
  lEx: number;
  lEz: number;
  lWx: number;
  lWz: number;
  rHip: number;
  rKnee: number;
  lHip: number;
  lKnee: number;
}
export type Joint = keyof Pose;
export type Action = "point" | "stamp" | "write" | "read" | "phone" | "wave" | "walk" | "swing" | "sit" | "stand";

export const REST: Readonly<Pose> = {
  hipX: 0,
  hipY: 0,
  hipRoll: 0,
  lean: 0,
  turn: 0,
  sway: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  gaze: 1,
  rSx: 0.04,
  rSz: -0.09,
  rEx: -0.16,
  rEz: 0,
  rWx: 0,
  rWz: 0,
  lSx: 0.04,
  lSz: 0.09,
  lEx: -0.16,
  lEz: 0,
  lWx: 0,
  lWz: 0,
  rHip: 0,
  rKnee: 0,
  lHip: 0,
  lKnee: 0,
};
export const JOINTS = Object.keys(REST) as Joint[];

/** How fast each joint chases its target (1/s). Slower down the arm = follow-through: shoulder, then elbow, then wrist. */
export const RATE: Readonly<Record<Joint, number>> = {
  hipX: 4,
  hipY: 12,
  hipRoll: 4,
  lean: 6,
  turn: 5,
  sway: 5,
  headYaw: 7,
  headPitch: 7,
  headRoll: 6,
  gaze: 3,
  rSx: 11,
  rSz: 11,
  rEx: 8,
  rEz: 8,
  rWx: 5.5,
  rWz: 5.5,
  lSx: 11,
  lSz: 11,
  lEx: 8,
  lEz: 8,
  lWx: 5.5,
  lWz: 5.5,
  rHip: 14,
  rKnee: 14,
  lHip: 14,
  lKnee: 14,
};

const { sin, cos, max, min, abs, PI } = Math;
const pulse = (t: number, every: number, length: number) => {
  const k = (t % every) / length;
  return k < 1 ? sin(PI * k) : 0;
};
const easeOut = (k: number) => 1 - (1 - k) ** 3;

/** Stamp cycle 0..1 → how high the hand is (1 = raised). Slow lift, fast drop, tiny rebound: weight. */
export function stampLift(t: number): number {
  const ph = (t * 0.85) % 1;
  if (ph < 0.55) return easeOut(ph / 0.55);
  if (ph < 0.66) return 1 - ((ph - 0.55) / 0.11) ** 2;
  return max(0, sin(((ph - 0.66) / 0.34) * PI) * 0.08 * (1 - (ph - 0.66) / 0.34));
}

/** Idle life under every action: slow weight shift from foot to foot, counter-swayed by the spine. */
function idle(t: number, p: Pose) {
  const shift = sin(t * 0.55);
  p.hipX += shift * 0.016;
  p.hipRoll += shift * 0.022;
  p.sway -= shift * 0.02;
  p.headRoll += sin(t * 0.37 + 1) * 0.02;
}

/** The greeting: shoulder leads, forearm swings a beat later, the wrist flops after it. */
export function wave(t: number, p: Pose, k = 1) {
  const w = t * 9.5;
  const mix = (j: Joint, to: number) => {
    p[j] += (to - p[j]) * k;
  };
  mix("rSx", -0.1);
  mix("rSz", -2.05 + sin(w) * 0.1);
  mix("rEx", -0.25);
  mix("rEz", -0.75 + sin(w - 0.7) * 0.42);
  mix("rWx", 0);
  mix("rWz", sin(w - 1.5) * 0.4);
  p.sway += (0.05 + sin(w) * 0.012) * k;
  p.headRoll += 0.07 * k;
  p.hipX -= 0.012 * k;
  p.gaze += (1 - p.gaze) * k;
}

const ACTIONS: Record<Action, (t: number, p: Pose) => void> = {
  stand: () => {},
  wave: (t, p) => wave(t * 0.8, p),
  /* Presenting the dashboard behind and to the right: open arm toward it, glancing between screen and visitor. */
  point: (t, p) => {
    const beat = sin(t * 1.6);
    const look = pulse(t, 6, 2.2);
    p.turn = -0.3 - look * 0.12;
    p.rSz = -1.28 + beat * 0.06;
    p.rSx = 0.3;
    p.rEx = -0.28 + max(0, beat) * -0.2;
    p.rWz = -0.25 + sin(t * 1.6 - 0.9) * 0.14;
    p.lSx = -0.42;
    p.lSz = 0.12;
    p.lEx = -1.5;
    p.lWx = -0.2;
    p.headYaw = -look * 0.75;
    p.gaze = 1 - look * 0.8;
    p.lean = 0.02;
  },
  /* Lift, slam, rebound; the other hand steadies the paper on the counter. */
  stamp: (t, p) => {
    const lift = stampLift(t);
    p.lean = 0.2 - lift * 0.07;
    p.rSx = -0.55 - lift * 0.5;
    p.rSz = -0.1;
    p.rEx = -0.95 - lift * 0.55;
    p.rWx = 0.35 - lift * 0.35;
    p.lSx = -0.62;
    p.lSz = -0.05;
    p.lEx = -0.9;
    p.lWx = 0.3;
    p.headPitch = 0.3 - lift * 0.1;
    p.gaze = 0.25 + pulse(t, 7, 1.6) * 0.6;
    p.headPitch -= pulse(t, 7, 1.6) * 0.25;
  },
  /* Writing on the easel at her right: small loops from the shoulder, checking the book, a look back to the class. */
  write: (t, p) => {
    const back = pulse(t, 8, 2.4);
    const line = (t * 0.22) % 1;
    p.turn = -0.62 + back * 0.5;
    p.rSz = -1.02 - line * 0.2 + sin(t * 6.5) * 0.045;
    p.rSx = -0.55 + cos(t * 6.5) * 0.05 + line * 0.12;
    p.rEx = -0.7 + sin(t * 6.5 + 0.6) * 0.07;
    p.rWx = sin(t * 13) * 0.12;
    p.lSx = -0.5;
    p.lSz = 0.1;
    p.lEx = -1.35;
    p.lWx = -0.1;
    p.headYaw = -0.5 + back * 0.8;
    p.headPitch = 0.08;
    p.gaze = back;
  },
  /* Both hands on the tablet, head down; taps with a finger, sometimes looks up, pleased. */
  read: (t, p) => {
    const up = pulse(t, 9, 2);
    const tap = pulse(t, 2.6, 0.5);
    p.lean = 0.07;
    p.lSx = -0.62;
    p.lSz = -0.16;
    p.lEx = -1.15;
    p.rSx = -0.6 - tap * 0.08;
    p.rSz = 0.2;
    p.rEx = -1.2 - tap * 0.1;
    p.rWx = tap * 0.35;
    p.headPitch = 0.42 - up * 0.42 + sin(t * 0.8) * 0.02;
    p.headRoll = sin(t * 0.5) * 0.05;
    p.gaze = up;
    p.sway = sin(t * 0.9) * 0.02;
  },
  /* Phone held up in the left hand, right thumb scrolling; looks up when the notification lands. */
  phone: (t, p) => {
    const up = pulse(t + 1, 4.5, 1.8);
    const flick = pulse(t, 1.4, 0.35);
    p.lSx = -0.5;
    p.lSz = -0.1;
    p.lEx = -1.75;
    p.lWx = 0.25;
    p.rSx = -0.32;
    p.rSz = 0.7;
    p.rEx = -1.62 + flick * 0.1;
    p.rWx = -flick * 0.4;
    p.headPitch = 0.36 - up * 0.36;
    p.headYaw = 0.1;
    p.gaze = up;
    p.lean = 0.04;
  },
  /* Walk cycle: opposite arm and leg, knee folds on the back swing, pelvis bobs twice per stride. */
  walk: (t, p) => {
    const a = t * 5.6;
    const s = sin(a);
    p.rHip = -s * 0.52;
    p.lHip = s * 0.52;
    p.rKnee = max(0, sin(a - 2.2)) * 0.95;
    p.lKnee = max(0, sin(a - 2.2 + PI)) * 0.95;
    p.rSx = s * 0.5;
    p.lSx = -s * 0.5;
    p.rEx = -0.35 - max(0, s) * 0.3;
    p.lEx = -0.35 - max(0, -s) * 0.3;
    p.hipY = abs(cos(a)) * 0.035 - 0.02;
    p.hipRoll = s * 0.04;
    p.sway = -s * 0.03;
    p.turn = s * 0.09;
    p.lean = 0.06;
    p.gaze = 0;
  },
  /* On the swing: hands on the ropes, legs pump with the arc (phase comes in as t). */
  swing: (t, p) => {
    const s = sin(t);
    p.hipY = -0.88;
    p.rHip = p.lHip = -1.35 + s * 0.2;
    p.rKnee = p.lKnee = 1.0 - s * 0.75;
    p.rSx = p.lSx = -1.0;
    p.rSz = -0.35;
    p.lSz = 0.35;
    p.rEx = p.lEx = -0.9;
    p.lean = -0.12 - s * 0.18;
    p.headPitch = s * 0.12;
    p.gaze = 0;
  },
  /* Seated at a desk, forearms on it; fidgets, and now and then a hand shoots up. */
  sit: (t, p) => {
    const hand = min(1, pulse(t, 11, 3) * 2.5);
    p.hipY = -0.42;
    p.rHip = p.lHip = -1.5;
    p.rKnee = p.lKnee = 1.45;
    p.lSx = -0.5;
    p.lEx = -1.1;
    p.lSz = -0.1;
    p.rSx = -0.5 - hand * 2.3;
    p.rEx = -1.1 + hand * 0.95;
    p.rSz = 0.1 - hand * 0.25;
    p.rWz = hand * sin(t * 9) * 0.25;
    p.lean = 0.1 - hand * 0.08;
    p.headPitch = 0.1 - hand * 0.2 + sin(t * 1.1) * 0.03;
    p.gaze = 0.2;
  },
};

/** Fill `out` with the pose for `action` at time `t`; `waveMix` 0..1 blends the greeting on top. */
export function poseAt(action: Action, t: number, waveMix: number, out: Pose): Pose {
  Object.assign(out, REST);
  ACTIONS[action](t, out);
  if (action !== "walk" && action !== "swing") idle(t, out);
  if (waveMix > 0.001 && action !== "wave") wave(t, out, min(1, waveMix));
  return out;
}
