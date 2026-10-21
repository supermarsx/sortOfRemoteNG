import { describe, expect, it } from "vitest";
import {
  parseSessionRouteHealth,
  parseVpnLeaseObservations,
} from "../../src/types/network/sessionRouteHealth";
import { parseNativeBrowserDiagnostics } from "../../src/types/network/nativeBrowserDiagnostics";
import { observedSessionRouteHops } from "../../src/utils/protocol/sessionRouteHealth";
import { deriveSessionConnectionHealth } from "../../src/utils/protocol/sessionConnectionHealth";
const report = () => ({
  sessionId: "actor",
  observedAtUnixMs: 1700000001000,
  hops: [
    {
      index: 0,
      kind: "proxy",
      state: "connected",
      evidence: "negotiated",
      stage: "proxy-negotiation",
      updatedAtUnixMs: 1700000000000,
    },
    {
      index: 1,
      kind: "ssh-jump",
      state: "connected",
      evidence: "runtime-active",
      stage: "channel-open",
      updatedAtUnixMs: 1700000001000,
    },
    {
      index: 2,
      kind: "local-forward",
      state: "connected",
      evidence: "forward-active",
      stage: "forward-listener",
      updatedAtUnixMs: 1700000001000,
    },
  ],
});
describe("sanitized per-component runtime route health", () => {
  it("retains the complete actual ordered route and distinguishes historical negotiation from active components", () => {
    const raw = report();
    raw.hops.reverse();
    const parsed = parseSessionRouteHealth(raw, "actor");
    expect(parsed.hops.map((hop) => hop.index)).toEqual([0, 1, 2]);
    const hops = observedSessionRouteHops(parsed);
    expect(hops.map((hop) => [hop.label, hop.status])).toEqual([
      ["Proxy · component 1", "unknown"],
      ["SSH jump · component 2", "healthy"],
      ["Local forward · component 3", "healthy"],
    ]);
    expect(hops[0].detail).toContain(
      "Negotiation succeeded during setup; current reachability is not checked",
    );
    expect(hops[0].detail).toContain("2023-11-14T22:13:20.000Z");
    expect(hops[1].detail).toContain("SSH channel");
    expect(
      deriveSessionConnectionHealth({
        protocol: "ssh",
        status: "connected",
        accessible: true,
        backendSessionId: "actor",
        alive: true,
        routeHealth: parsed,
      }).hops,
    ).toEqual(hops);
  });
  it("projects closed fields only, dropping endpoint, raw error and credential-bearing extras", () => {
    const raw = report();
    Object.assign(raw, {
      address: "PRIVATE_HOST",
      password: "PRIVATE_PASSWORD",
    });
    Object.assign(raw.hops[0], {
      error: "PRIVATE_ERROR",
      config: { password: "PRIVATE_SECRET" },
      counters: { PRIVATE_COUNTER: 1 },
    });
    expect(JSON.stringify(parseSessionRouteHealth(raw, "actor"))).not.toContain(
      "PRIVATE",
    );
  });
  it.each(["kind", "state", "evidence", "stage"])(
    "rejects unknown %s values",
    (field) => {
      const raw = report();
      Object.assign(raw.hops[0], { [field]: "PRIVATE_ERROR" });
      expect(() => parseSessionRouteHealth(raw, "actor")).toThrow(
        "Route health is unavailable.",
      );
    },
  );
  it.each(["owner", "duplicate", "overflow", "timestamp", "future-stage"])(
    "rejects %s scope or bounds violations",
    (kind) => {
      const raw = report();
      if (kind === "owner") raw.sessionId = "foreign";
      if (kind === "duplicate") raw.hops[1].index = 0;
      if (kind === "overflow")
        raw.hops = Array.from({ length: 65 }, (_, index) => ({
          ...raw.hops[0],
          index,
        }));
      if (kind === "timestamp") raw.observedAtUnixMs = Infinity;
      if (kind === "future-stage")
        raw.hops[0].updatedAtUnixMs = raw.observedAtUnixMs + 1;
      expect(() => parseSessionRouteHealth(raw, "actor")).toThrow();
    },
  );
  it("parses the CEF route only within its containing browser session observation", () => {
    const value = {
      available: true,
      sessions: [
        {
          identity: {
            connectionId: "web",
            sessionId: "actor",
            attemptId: "attempt",
          },
          phase: "attached",
          proxy: null,
          routeHealth: report(),
        },
      ],
    };
    expect(
      parseNativeBrowserDiagnostics(value).sessions[0].routeHealth?.hops,
    ).toHaveLength(3);
    value.sessions[0].routeHealth.sessionId = "foreign";
    expect(() => parseNativeBrowserDiagnostics(value)).toThrow();
  });
  it("preserves unavailable native clock values without inventing a timestamp", () => {
    const raw = {
      ...report(),
      observedAtUnixMs: null,
      hops: report().hops.map((hop) => ({ ...hop, updatedAtUnixMs: null })),
    };
    expect(
      observedSessionRouteHops(parseSessionRouteHealth(raw, "actor"))[0].detail,
    ).toContain("Stage updated Not available; snapshot Not available");
  });
  it("does not paint the route healthy merely because the outer SSH actor is alive", () => {
    const raw = report();
    raw.hops[1].state = "failed";
    raw.hops[1].evidence = "negotiation-failed";
    const value = deriveSessionConnectionHealth({
      protocol: "ssh",
      status: "connected",
      accessible: true,
      backendSessionId: "actor",
      alive: true,
      routeHealth: parseSessionRouteHealth(raw, "actor"),
    });
    expect(value.status).toBe("degraded");
    expect(value.hops[1].status).toBe("degraded");
  });
  it("never relabels live components from edited saved metadata with the same kinds/order", () => {
    const native = parseSessionRouteHealth(report(), "actor");
    const hops = deriveSessionConnectionHealth({
      protocol: "ssh",
      status: "connected",
      accessible: true,
      backendSessionId: "actor",
      alive: true,
      routeHealth: native,
      connection: {
        id: "saved",
        name: "Edited target",
        protocol: "ssh",
        hostname: "private.test",
        port: 22,
        security: {
          tunnelChain: [
            {
              id: "proxy",
              type: "http-proxy",
              enabled: true,
              name: "Replacement proxy",
            },
            {
              id: "jump",
              type: "ssh-jump",
              enabled: true,
              name: "Replacement jump",
            },
          ],
        },
      } as import("../../src/types/connection/connection").Connection,
    }).hops;
    expect(hops[0].label).toBe("Proxy · component 1");
    expect(hops[1].label).toBe("SSH jump · component 2");
    native.hops.push({ ...native.hops[1], index: 3, kind: "ssh" });
    expect(
      observedSessionRouteHops(native, {
        sourceProtocol: "ssh",
        sourceName: "Creation-time session name",
      })[3].label,
    ).toBe("Creation-time session name · SSH transport");
  });
  it("distinguishes repeated native components without guessing a saved name", () => {
    const raw = report();
    raw.hops[1].kind = "proxy";
    const hops = observedSessionRouteHops(
      parseSessionRouteHealth(raw, "actor"),
    );
    expect(hops.slice(0, 2).map((hop) => hop.label)).toEqual([
      "Proxy · component 1",
      "Proxy · component 2",
    ]);
  });
  it("discloses truncated telemetry and does not attach configured upstream names to an incomplete chain", () => {
    const native = parseSessionRouteHealth(
      { ...report(), truncated: true },
      "actor",
    );
    const hops = observedSessionRouteHops(native);
    expect(hops[0].label).toBe("Proxy · component 1");
    expect(hops[hops.length - 1]).toMatchObject({
      label: "Additional route components",
      status: "unknown",
    });
    expect(hops[hops.length - 1].detail).toContain("not a complete chain");
    expect(parseSessionRouteHealth(report(), "actor").truncated).toBe(false);
    expect(() =>
      parseSessionRouteHealth({ ...report(), truncated: "false" }, "actor"),
    ).toThrow();
  });
  it("rejects foreign, incomplete or unsupported VPN ownership observations", () => {
    const row = {
      ownerId: "owned",
      truncated: false,
      leases: [
        {
          vpnType: "wireguard",
          connectionId: "PRIVATE",
          leaseOwned: true,
          providerState: "unknown",
          observedAtUnixMs: null,
          cleanupPending: false,
        },
      ],
    };
    expect(parseVpnLeaseObservations([row], ["owned"])).toHaveLength(1);
    expect(() => parseVpnLeaseObservations([row], ["other"])).toThrow();
    expect(() => parseVpnLeaseObservations([], ["owned"])).toThrow();
    expect(() =>
      parseVpnLeaseObservations(
        [{ ...row, leases: [{ ...row.leases[0], vpnType: "PRIVATE_ERROR" }] }],
        ["owned"],
      ),
    ).toThrow();
  });
  it("uses only actual native endpoints and omits malformed endpoint metadata", () => {
    const raw = report();
    Object.assign(raw.hops[0], {
      endpoint: {
        host: "proxy.actual.test",
        port: 1080,
        protocol: "socks5",
        password: "PRIVATE",
      },
    });
    const parsed = parseSessionRouteHealth(raw, "actor");
    expect(observedSessionRouteHops(parsed)[0].label).toContain(
      "proxy.actual.test:1080",
    );
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE");
    Object.assign(raw.hops[0], {
      endpoint: { host: "2001:db8::1", port: 22, protocol: "ssh" },
    });
    expect(
      observedSessionRouteHops(parseSessionRouteHealth(raw, "actor"))[0].label,
    ).toContain("[2001:db8::1]:22");
    for (const endpoint of [
      { host: "user:password@private", port: 22, protocol: "ssh" },
      { host: "https://private/path?token=SECRET", port: 443, protocol: "tcp" },
      { host: "broken::ipv6", port: 22, protocol: "ssh" },
      { host: "host", port: 0, protocol: "ssh" },
      { host: "host", port: 22, protocol: "PRIVATE_ERROR" },
    ]) {
      Object.assign(raw.hops[0], { endpoint });
      expect(
        parseSessionRouteHealth(raw, "actor").hops[0].endpoint,
      ).toBeUndefined();
    }
  });
  it("displays only timestamped owned VPN provider samples as connected or degraded", () => {
    const derive = (
      providerState: "connected" | "disconnected" | "unknown",
      observedAtUnixMs: number | null,
    ) =>
      deriveSessionConnectionHealth({
        protocol: "ssh",
        status: "connected",
        backendSessionId: "actor",
        accessible: true,
        alive: true,
        vpnLeases: [
          {
            ownerId: "private",
            truncated: false,
            leases: [
              {
                vpnType: "wireguard",
                connectionId: "private",
                leaseOwned: true,
                cleanupPending: false,
                providerState,
                observedAtUnixMs,
              },
            ],
          },
        ],
      });
    expect(derive("connected", 1700000000000).prerequisites?.[0]).toMatchObject(
      {
        status: "healthy",
      },
    );
    expect(derive("disconnected", 1700000000000).status).toBe("degraded");
    expect(derive("connected", null).prerequisites?.[0].status).toBe("unknown");
    expect(derive("unknown", 1700000000000).prerequisites?.[0].status).toBe(
      "unknown",
    );
  });
  it("removes saved names, native endpoints and VPN observations when database access is lost", () => {
    const raw = report();
    Object.assign(raw.hops[0], {
      endpoint: {
        host: "PRIVATE_RUNTIME_HOST",
        port: 1080,
        protocol: "socks5",
      },
    });
    const value = deriveSessionConnectionHealth({
      protocol: "ssh",
      status: "connected",
      accessible: false,
      backendSessionId: "actor",
      alive: true,
      sourceName: "PRIVATE_SESSION_NAME",
      routeHealth: parseSessionRouteHealth(raw, "actor"),
      connection: {
        protocol: "ssh",
        name: "PRIVATE_SAVED_NAME",
        security: {
          tunnelChain: [
            {
              id: "p",
              name: "PRIVATE_ROUTE_NAME",
              type: "ssh-jump",
              enabled: true,
            },
          ],
        },
      } as import("../../src/types/connection/connection").Connection,
      vpnLeases: [
        {
          ownerId: "PRIVATE_OWNER",
          truncated: false,
          leases: [
            {
              vpnType: "wireguard",
              connectionId: "PRIVATE_VPN_ID",
              leaseOwned: true,
              cleanupPending: false,
              providerState: "connected",
              observedAtUnixMs: 1700000000000,
            },
          ],
        },
      ],
    });
    expect(value.hops).toEqual([]);
    expect(value.prerequisites).toBeUndefined();
    expect(JSON.stringify(value)).not.toContain("PRIVATE");
  });
});
