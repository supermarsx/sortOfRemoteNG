/**
 * Per-host gate for server-stats polling. The stats exec shares the SSH
 * connection with the interactive terminal, so polls must be serialized per
 * host, never faster than MIN_POLL_GAP_MS, and back off after failures.
 * Module-level so every hook instance / view shares one gate.
 */
export const MIN_POLL_GAP_MS = 5_000;
export const MAX_BACKOFF_MS = 120_000;

interface HostGate {
  inFlight: boolean;
  lastStartedAt: number;
  failures: number;
  retryNotBefore: number;
}

const gates = new Map<string, HostGate>();

function gate(id: string): HostGate {
  let g = gates.get(id);
  if (!g) {
    g = { inFlight: false, lastStartedAt: 0, failures: 0, retryNotBefore: 0 };
    gates.set(id, g);
  }
  return g;
}

export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(MIN_POLL_GAP_MS * 2 ** failures, MAX_BACKOFF_MS);
}

/**
 * Try to begin a poll. Manual polls bypass the gap and backoff but never run
 * concurrently with another poll of the same host.
 */
export function tryBeginPoll(
  id: string,
  kind: "auto" | "manual",
  now: number = Date.now(),
): boolean {
  const g = gate(id);
  if (g.inFlight) return false;
  if (kind === "auto") {
    if (now - g.lastStartedAt < MIN_POLL_GAP_MS) return false;
    if (now < g.retryNotBefore) return false;
  }
  g.inFlight = true;
  g.lastStartedAt = now;
  return true;
}

export function endPoll(
  id: string,
  ok: boolean,
  now: number = Date.now(),
): void {
  const g = gate(id);
  g.inFlight = false;
  if (ok) {
    g.failures = 0;
    g.retryNotBefore = 0;
  } else {
    g.failures += 1;
    g.retryNotBefore = now + backoffMs(g.failures);
  }
}

export function resetPollGates(): void {
  gates.clear();
}
