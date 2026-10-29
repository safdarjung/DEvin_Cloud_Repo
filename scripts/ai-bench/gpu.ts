// T-040 — GPU sampling via `nvidia-smi` and offload check via `ollama ps`.
// Shells out only; no network, no DB. Failures here never crash the bench —
// a missing/erroring `nvidia-smi` just means no GPU numbers in the report.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GpuSample {
  atMs: number;
  memUsedMiB: number;
  powerDrawW: number;
}

async function queryOnce(): Promise<Omit<GpuSample, "atMs"> | null> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=memory.used,power.draw",
      "--format=csv,noheader,nounits",
    ]);
    const [memUsedMiB, powerDrawW] = stdout.trim().split(",").map((v) => Number.parseFloat(v.trim()));
    if (Number.isNaN(memUsedMiB) || Number.isNaN(powerDrawW)) return null;
    return { memUsedMiB, powerDrawW };
  } catch {
    return null; // no GPU, driver not installed, or permission issue — not fatal
  }
}

/** One-shot baseline reading, taken before any model load (packet: "baseline before model load"). */
export async function gpuBaseline(): Promise<GpuSample | null> {
  const sample = await queryOnce();
  return sample ? { atMs: Date.now(), ...sample } : null;
}

export interface GpuSampler {
  /** Current samples without stopping the sampler. */
  peek(): GpuSample[];
  stop(): GpuSample[];
}

/** Samples every `intervalMs` (packet: 500 ms) until `stop()` is called. */
export function startGpuSampling(intervalMs = 500): GpuSampler {
  const samples: GpuSample[] = [];
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    const sample = await queryOnce();
    if (sample) samples.push({ atMs: Date.now(), ...sample });
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  let timer: NodeJS.Timeout = setTimeout(tick, intervalMs);

  return {
    peek(): GpuSample[] {
      return [...samples];
    },
    stop(): GpuSample[] {
      stopped = true;
      clearTimeout(timer);
      return samples;
    },
  };
}

export function averagePowerWatts(samples: readonly GpuSample[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, s) => sum + s.powerDrawW, 0) / samples.length;
}

export function peakMemUsedMiB(samples: readonly GpuSample[]): number {
  if (samples.length === 0) return 0;
  return Math.max(...samples.map((s) => s.memUsedMiB));
}

export type OffloadState = "full_gpu" | "offload_partial" | "unknown";

/**
 * Checks `ollama ps` for whether `modelId` is fully on GPU. Ollama prints a
 * PROCESSOR column like "100% GPU" or "48%/52% CPU/GPU" — anything other
 * than a clean "100% GPU" is reported as `offload_partial` rather than
 * hidden, per the packet's VRAM-spill assumption.
 */
export async function checkOllamaOffload(modelId: string): Promise<OffloadState> {
  try {
    const { stdout } = await execFileAsync("ollama", ["ps"]);
    const line = stdout.split("\n").find((l) => l.startsWith(modelId) || l.includes(modelId));
    if (!line) return "unknown";
    return /100%\s*GPU/i.test(line) ? "full_gpu" : "offload_partial";
  } catch {
    return "unknown";
  }
}
