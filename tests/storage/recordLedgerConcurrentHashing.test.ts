import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";

const library = (size: number, renamed?: number) => ({
  connections: Array.from({ length: size }, (_, index) => ({
    id: `c${index}`,
    name: index === renamed ? "Renamed" : `Connection ${index}`,
    protocol: "ssh",
    hostname: `host-${index}.example`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })),
});
const NOW = { mode: "write" as const, now: "2026-02-01T00:00:00.000Z" };

afterEach(() => vi.unstubAllGlobals());

it("hashes records concurrently instead of one awaited digest per record", async () => {
  let inFlight = 0;
  let peak = 0;
  vi.stubGlobal("crypto", {
    subtle: {
      digest: async (algorithm: string, data: Uint8Array) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return webcrypto.subtle.digest(algorithm, data);
      },
    },
  });
  const base = await reconcileRecordLedger(library(200), undefined, NOW);
  peak = 0;
  const next = await reconcileRecordLedger(library(200, 7), base, {
    ...NOW,
    now: "2026-02-02T00:00:00.000Z",
  });
  // 200 content hashes plus the root record; the old serial loop peaked at 1.
  expect(peak).toBeGreaterThan(100);

  // Identical ledger to one computed with the unwrapped digest.
  vi.stubGlobal("crypto", webcrypto);
  const reference = await reconcileRecordLedger(library(200, 7), base, {
    ...NOW,
    now: "2026-02-02T00:00:00.000Z",
  });
  expect(next).toEqual(reference);
  // Only the edited record and its containers were journaled, not all 200.
  const appended = next.journal.length - base.journal.length;
  expect(appended).toBeGreaterThan(0);
  expect(appended).toBeLessThan(5);
});
