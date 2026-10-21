import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { OriginBrowserState } from "../../src/hooks/protocol/useOriginBrowser";
import type { NativeBrowserSessionDiagnostics } from "../../src/types/network/nativeBrowserDiagnostics";
import {
  configuredOriginRouteHops,
  deriveOriginConnectionHealth,
  summarizedOriginRouteHops,
} from "../../src/utils/protocol/originConnectionHealth";
import { resolveNetworkPath } from "../../src/utils/network/resolveNetworkPath";

const connection = {
  id: "web",
  protocol: "https",
  hostname: "PRIVATE_HOST",
  password: "PRIVATE_PASSWORD",
  security: {
    tunnelChain: [
      {
        id: "ssh",
        type: "ssh-jump",
        enabled: true,
        sshTunnel: {
          host: "PRIVATE_SSH",
          username: "PRIVATE_USER",
          password: "PRIVATE_PASSWORD",
          forwardType: "local",
        },
      },
      {
        id: "proxy",
        type: "proxy",
        enabled: true,
        proxy: { proxyType: "socks5" },
      },
    ],
  },
} as unknown as Connection;
const state = (): OriginBrowserState => ({
  phase: "attached",
  snapshot: {
    identity: {
      ownerDatabaseId: "db",
      connectionId: "web",
      sessionId: "tab",
      attemptId: "attempt",
    },
    sequence: 1,
    phase: "attached",
    displayUrl: "https://site.example",
    loading: false,
    documentLoaded: true,
    canGoBack: false,
    canGoForward: false,
    title: "PRIVATE_TITLE",
  },
  error: null,
  unavailableReason: null,
});
const observation = (): NativeBrowserSessionDiagnostics => ({
  identity: { connectionId: "web", sessionId: "tab", attemptId: "attempt" },
  phase: "attached",
  proxy: {
    state: "listening",
    acceptedConnections: 1,
    authenticationChallenges: 0,
    authenticatedRequests: 1,
    destinationDenials: 0,
    upstreamFailures: 0,
    requestRejections: 0,
    capacityRefusals: 0,
  },
});
const health = (
  change: Partial<Parameters<typeof deriveOriginConnectionHealth>[0]> = {},
) =>
  deriveOriginConnectionHealth({
    connection,
    state: state(),
    observation: observation(),
    enabled: true,
    ...change,
  });

describe("observed connection health", () => {
  it("shows a saved SSH source name without exposing its connection credentials", () => {
    const selected = {
      id: "gateway",
      protocol: "ssh",
      name: "Office gateway",
      hostname: "PRIVATE_HOST",
      port: 22,
      username: "PRIVATE_USER",
      password: "PRIVATE_PASSWORD",
    } as Connection;
    const linked = {
      ...connection,
      security: {
        tunnelChain: [
          {
            id: "hop",
            type: "ssh-jump",
            enabled: true,
            sshTunnel: { connectionId: "gateway", forwardType: "local" },
          },
        ],
      },
    } as Connection;
    const catalog = { connections: [selected, linked] };
    const resolution = resolveNetworkPath(linked, catalog);
    const rows = summarizedOriginRouteHops(
      resolution.summary,
      catalog.connections,
      linked,
    );
    expect(rows[0]).toMatchObject({
      label: "Office gateway",
      kind: "Configured SSH jump",
      status: "unknown",
    });
    expect(JSON.stringify(rows)).not.toContain("PRIVATE_");
  });
  it("does not infer healthy SSH hops from a successful document or proxy listener", () => {
    const result = health();
    expect(result.status).toBe("healthy");
    expect(result.label).toBe("Last load succeeded");
    expect(result.summary).toContain("not continuously probed");
    expect(result.hops.map((hop) => hop.label)).toEqual([
      "Private proxy",
      "SSH jump",
      "Proxy",
      "Website",
    ]);
    expect(result.hops.slice(1, -1).map((hop) => hop.status)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });
  it.each(["attemptId", "connectionId", "sessionId"] as const)(
    "rejects another %s's observation",
    (field) => {
      const reading = observation();
      reading.identity[field] = "other";
      expect(health({ observation: reading }).status).toBe("unknown");
    },
  );
  it("requires a completed main document and a current nonbusy native proxy snapshot", () => {
    expect(health({ observation: null }).status).toBe("unknown");
    const reading = observation();
    reading.phase = null;
    expect(health({ observation: reading }).status).toBe("unknown");
    reading.phase = "attached";
    reading.proxy = null;
    expect(health({ observation: reading }).status).toBe("unknown");
    const browser = state();
    browser.snapshot = { ...browser.snapshot!, documentLoaded: false };
    expect(health({ state: browser }).status).toBe("unknown");
  });
  it("keeps historical upstream failures separate from current page health", () => {
    const reading = observation();
    reading.proxy!.upstreamFailures = 7;
    expect(health({ observation: reading }).status).toBe("healthy");
    expect(health({ observation: reading }).details).toContainEqual([
      "Upstream failures this attempt",
      "7",
    ]);
  });
  it("shows connecting during navigation and degraded for a current failed request", () => {
    const browser = state();
    browser.snapshot = { ...browser.snapshot!, loading: true };
    expect(health({ state: browser }).status).toBe("connecting");
    const hops = health({ state: browser }).hops;
    expect(hops[hops.length - 1].status).toBe("connecting");
    browser.snapshot = {
      ...browser.snapshot!,
      loading: false,
      loadFailure: { code: -118, category: "timeout" },
    };
    expect(health({ state: browser }).status).toBe("degraded");
  });
  it.each(["revoking", "stopped", "listener-failed", "task-ended"] as const)(
    "reports the actual %s proxy as disconnected",
    (phase) => {
      const reading = observation();
      reading.proxy!.state = phase;
      expect(health({ observation: reading }).status).toBe("disconnected");
    },
  );
  it("makes closed runtime evidence win over a stale completed document", () => {
    const reading = observation();
    reading.phase = "closed";
    expect(health({ observation: reading }).status).toBe("disconnected");
    expect(health({ enabled: false }).status).toBe("unknown");
  });
  it("hides the control for a connection with no configured extra route", () => {
    expect(
      health({ connection: { id: "web", protocol: "https" } as Connection })
        .visible,
    ).toBe(false);
  });
  it("preserves reference placeholders and selected-source precedence", () => {
    const rows = configuredOriginRouteHops({
      ...connection,
      proxyProfileId: "PRIVATE_PROFILE",
      proxyChainId: "PRIVATE_SHADOWED",
      tunnelProfileId: "PRIVATE_TUNNEL",
      tunnelChainId: "PRIVATE_CHAIN",
    });
    expect(rows.map((row) => row.label)).toEqual([
      "Saved proxy profile",
      "Saved tunnel profile",
    ]);
    expect(rows.every((row) => row.status === "unknown")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE_");
  });
  it("expands saved chain order using only the resolver's safe summary", () => {
    const resolved = resolveNetworkPath({
      ...connection,
      security: {
        tunnelChain: [
          {
            id: "second",
            type: "proxy",
            enabled: true,
            proxy: { proxyType: "socks5", host: "PRIVATE_PROXY", port: 1080 },
          },
          {
            id: "first",
            type: "ssh-jump",
            enabled: true,
            sshTunnel: {
              host: "PRIVATE_SSH",
              port: 22,
              username: "PRIVATE_USER",
              password: "PRIVATE_PASSWORD",
              forwardType: "local",
            },
          },
        ],
      },
    } as Connection);
    const rows = summarizedOriginRouteHops(resolved.summary);
    expect(rows.slice(0, 2).map((row) => row.label)).toEqual([
      "Proxy",
      "SSH jump",
    ]);
    expect(rows.every((row) => row.status === "unknown")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE_");
  });
  it("does not silently drop missing references from a partial route", () => {
    const resolution = resolveNetworkPath({
      ...connection,
      tunnelProfileId: "PRIVATE_MISSING",
    });
    const rows = summarizedOriginRouteHops(resolution.summary);
    expect(rows[rows.length - 1]).toMatchObject({
      status: "unknown",
      label: "Unresolved route details",
    });
    expect(rows[rows.length - 1].detail).toContain("partial route");
  });
});
