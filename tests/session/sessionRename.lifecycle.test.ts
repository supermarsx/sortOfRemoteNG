import { describe, expect, it } from "vitest";
import { mergeLocalSessionUpdate } from "../../src/utils/session/sessionLifecycle";
import type { ConnectionSession } from "../../src/types/connection/connection";

const base = (): ConnectionSession =>
  ({
    id: "s1",
    connectionId: "c1",
    name: "Session One",
    status: "connected",
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    protocol: "ssh",
    hostname: "h",
    lifecycleRevision: 3,
    lifecycleActorGeneration: 1,
    lifecycleWriterId: "main",
    backendSessionId: "b1",
  }) as ConnectionSession;

describe("mergeLocalSessionUpdate presentation updates", () => {
  it("applies a rename sent as a partial update", () => {
    const current = base();
    const merged = mergeLocalSessionUpdate(current, {
      id: "s1",
      name: "Renamed",
    });
    expect(merged.name).toBe("Renamed");
  });
});
