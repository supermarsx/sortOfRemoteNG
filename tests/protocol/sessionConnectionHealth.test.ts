import { describe, expect, it } from "vitest";
import { deriveSessionConnectionHealth } from "../../src/utils/protocol/sessionConnectionHealth";
import type { RDPStatsEvent } from "../../src/types/rdp/rdpEvents";
import type { Connection } from "../../src/types/connection/connection";
const base = {
  protocol: "ssh" as const,
  status: "connected",
  backendSessionId: "actor",
  accessible: true,
};
const stats = {
  phase: "active",
  session_id: "actor",
  uptime_secs: 12,
  bytes_received: 0,
  bytes_sent: 25,
  frame_count: 5,
  errors_recovered: 99,
  last_error: "PRIVATE_ERROR",
} as RDPStatsEvent;
describe("SSH and RDP observed connection health", () => {
  it.each([
    ["initializing", "connecting"],
    ["tcp_connect", "connecting"],
    ["reconnecting", "connecting"],
    ["error", "degraded"],
    ["disconnected", "disconnected"],
    ["terminated", "disconnected"],
    ["unsupported", "unknown"],
  ] as const)(
    "honors native stats phase %s despite a connected UI",
    (phase, status) => {
      expect(
        deriveSessionConnectionHealth({
          ...base,
          protocol: "rdp",
          stats: { ...stats, phase },
        }).status,
      ).toBe(status);
    },
  );
  it.each([
    [true, "healthy"],
    [false, "disconnected"],
    [null, "unknown"],
  ] as const)("requires a native SSH actor result %s", (alive, status) => {
    expect(deriveSessionConnectionHealth({ ...base, alive }).status).toBe(
      status,
    );
  });
  it("never treats a connected UI or configured tunnel as proof of healthy hops", () => {
    const connection = {
      security: { sshTunnel: { enabled: true } },
    } as Connection;
    const value = deriveSessionConnectionHealth({ ...base, connection });
    expect(value.status).toBe("unknown");
    expect(value.hops).toEqual([
      expect.objectContaining({ status: "unknown", label: "SSH tunnel" }),
    ]);
    expect(
      deriveSessionConnectionHealth({
        ...base,
        alive: true,
        backendSessionId: null,
      }).status,
    ).toBe("unknown");
  });
  it.each(["connecting", "reconnecting", "disconnected", "error"])(
    "uses the reported %s state without claiming reachability",
    (status) => {
      const value = deriveSessionConnectionHealth({
        ...base,
        status,
        alive: true,
      });
      expect(value.status).toBe(
        status === "error"
          ? "degraded"
          : status === "disconnected"
            ? "disconnected"
            : "connecting",
      );
      expect(
        deriveSessionConnectionHealth({
          ...base,
          status,
          alive: true,
          accessible: false,
        }).status,
      ).toBe("unknown");
    },
  );
  it("accepts only current RDP actor telemetry, with sampled and historical counters labelled", () => {
    const value = deriveSessionConnectionHealth({
      ...base,
      protocol: "rdp",
      stats,
    });
    expect(value.status).toBe("healthy");
    expect(value.details).toContainEqual(["Sampled bytes received", "0"]);
    expect(value.details).toContainEqual(["Historical recovered errors", "99"]);
    expect(JSON.stringify(value)).not.toContain("PRIVATE_ERROR");
    expect(
      deriveSessionConnectionHealth({
        ...base,
        protocol: "rdp",
        stats: { ...stats, session_id: "previous" },
      }).status,
    ).toBe("unknown");
  });
  it("distinguishes current failed channels from historical recoveries", () => {
    const lifecycle = {
      sessionId: "actor",
      state: "active",
      channelSummary: { enabledCount: 3, readyCount: 2, failedCount: 1 },
    } as NonNullable<RDPStatsEvent["lifecycle"]>;
    expect(
      deriveSessionConnectionHealth({
        ...base,
        protocol: "rdp",
        stats,
        lifecycle,
      }).status,
    ).toBe("degraded");
    expect(
      deriveSessionConnectionHealth({
        ...base,
        protocol: "rdp",
        stats,
        lifecycle: { ...lifecycle, sessionId: "old" },
      }).status,
    ).toBe("healthy");
    expect(
      deriveSessionConnectionHealth({
        ...base,
        protocol: "rdp",
        stats,
        lifecycle: { ...lifecycle, state: "closed" },
      }).status,
    ).toBe("disconnected");
  });
  it("omits invalid counters instead of rendering untrusted values", () => {
    const value = deriveSessionConnectionHealth({
      ...base,
      protocol: "rdp",
      stats: { ...stats, bytes_sent: Infinity, bytes_received: -1 },
    });
    expect(
      value.details.some(
        ([key]) =>
          key === "Sampled bytes sent" || key === "Sampled bytes received",
      ),
    ).toBe(false);
  });
  it("does not treat a lifecycle-only initializing actor as connected", () => {
    expect(
      deriveSessionConnectionHealth({
        ...base,
        protocol: "rdp",
        lifecycle: { sessionId: "actor", state: "initializing" } as NonNullable<
          RDPStatsEvent["lifecycle"]
        >,
      }).status,
    ).toBe("connecting");
  });
});
