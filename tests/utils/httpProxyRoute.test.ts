import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { ProxyConfig } from "../../src/types/settings/settings";
import {
  httpProxyUrl,
  mergeHttpProxyRoutes,
} from "../../src/utils/network/httpProxyRoute";
import { buildRuntimeNetworkPath } from "../../src/utils/network/resolveRuntimeNetworkPath";
import type { NetworkPathCatalog } from "../../src/utils/network/resolveNetworkPath";
import { captureHttpNetworkRoute } from "../../src/hooks/integration/httpNetworkRoute";

const mocks = vi.hoisted(() => ({ global: undefined as string | undefined }));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => mocks.global,
}));
const proxy: ProxyConfig = {
  enabled: true,
  type: "http-connect",
  host: "proxy.test",
  port: 8080,
  username: "alice",
  password: "p@ss",
};
const target = (overrides: Partial<Connection> = {}) =>
  ({
    id: "web",
    name: "Web",
    protocol: "https",
    hostname: "web.test",
    port: 443,
    ...overrides,
  }) as Connection;
const catalog: NetworkPathCatalog = {
  connections: [],
  connectionChains: [],
  proxyCollection: {
    profiles: [
      {
        id: "upstream",
        name: "Upstream",
        config: proxy,
        createdAt: "2026-09-30",
        updatedAt: "2026-09-30",
      },
    ],
    chains: [],
    tunnelChains: [],
    tunnelProfiles: [],
  },
};
beforeEach(() => {
  mocks.global = undefined;
});

describe("single HTTP upstream adapter", () => {
  it.each(["http", "https", "http-connect"] as const)(
    "executes a direct saved %s proxy without adding secrets to snapshots",
    (type) => {
      const data = structuredClone(catalog);
      data.proxyCollection!.profiles[0].config.type = type;
      const result = buildRuntimeNetworkPath(
        target({ proxyProfileId: "upstream" }),
        data,
        "http",
      );
      expect(result.httpUpstreamProxyUrl).toBe(
        `${type === "https" ? "https" : "http"}://alice:p%40ss@proxy.test:8080/`,
      );
      expect(result.snapshot.proxyProfileIds).toEqual(["upstream"]);
      expect(JSON.stringify(result.snapshot)).not.toMatch(
        /alice|p@ss|p%40ss|proxy.test/,
      );
    },
  );
  it("executes a legacy inline HTTP proxy", () => {
    expect(
      buildRuntimeNetworkPath(target({ security: { proxy } }), catalog, "http")
        .httpUpstreamProxyUrl,
    ).toBe(httpProxyUrl(proxy));
  });
  it.each(["socks4", "socks5", "ssh"] as const)(
    "rejects %s without a direct fallback",
    (type) => {
      expect(() =>
        buildRuntimeNetworkPath(
          target({ security: { proxy: { ...proxy, type } } }),
          catalog,
          "http",
        ),
      ).toThrow();
    },
  );
  it("rejects multiple layers even if the proxies are identical", () => {
    expect(() =>
      buildRuntimeNetworkPath(
        target({ proxyProfileId: "upstream", security: { proxy } }),
        catalog,
        "http",
      ),
    ).toThrow(/multi-hop/);
  });
  it("rejects missing saved profiles", () => {
    expect(() =>
      buildRuntimeNetworkPath(
        target({ proxyProfileId: "deleted" }),
        catalog,
        "http",
      ),
    ).toThrow(/Network path blocked/);
  });
  it("keeps global-only routing and deduplicates equivalent local/global routes", () => {
    expect(mergeHttpProxyRoutes(undefined, "http://proxy.test:80")).toBe(
      "http://proxy.test:80",
    );
    expect(
      mergeHttpProxyRoutes("http://PROXY.test:80/", "http://proxy.test"),
    ).toBe("http://proxy.test");
    expect(
      mergeHttpProxyRoutes(
        httpProxyUrl(proxy),
        "http://alice:p%40ss@proxy.test:8080",
      ),
    ).toBe("http://alice:p%40ss@proxy.test:8080");
  });
  it.each([
    "http://other.test:8080",
    "https://proxy.test:8080",
    "http://bob:other-secret@proxy.test:8080",
  ])(
    "rejects a distinct global route %s without leaking credentials",
    (global) => {
      try {
        mergeHttpProxyRoutes(httpProxyUrl(proxy), global);
        expect.fail("must reject");
      } catch (error) {
        expect(String(error)).toMatch(/cannot chain/);
        expect(String(error)).not.toMatch(/alice|p@ss|p%40ss|other-secret/);
      }
    },
  );
  it.each(["bad/path", "bad?query", "bad#hash", "bad@host", "[bad-ipv6]"])(
    "rejects malformed host %s with a safe error",
    (host) => {
      expect(() => httpProxyUrl({ ...proxy, host })).toThrow(/invalid/);
    },
  );
  it("brackets IPv6 and percent-encodes proxy authentication", () => {
    expect(httpProxyUrl({ ...proxy, host: "::1" })).toBe(
      "http://alice:p%40ss@[::1]:8080/",
    );
  });
  it("fences global changes, profile changes, deletion and new routes on direct connections", () => {
    let connection = target({ proxyProfileId: "upstream" });
    const runtime = buildRuntimeNetworkPath(connection, catalog, "http");
    runtime.assertCurrent = vi.fn();
    const route = captureHttpNetworkRoute(runtime, () => connection);
    route.assertCurrent();
    expect(runtime.assertCurrent).toHaveBeenCalled();
    expect(
      route.redactError(
        new Error(`upstream ${route.upstreamProxyUrl} alice p@ss p%40ss`),
      ),
    ).not.toMatch(/alice|p@ss|p%40ss/);
    mocks.global = "http://other.test:8080";
    expect(route.assertCurrent).toThrow(/route changed/);
    mocks.global = undefined;
    connection = target({ proxyProfileId: "changed" });
    expect(route.assertCurrent).toThrow(/route changed/);
    connection = target();
    const direct = captureHttpNetworkRoute(null, () => connection);
    connection = target({ proxyProfileId: "upstream" });
    expect(direct.assertCurrent).toThrow(/route changed/);
    connection = target({ proxyProfileId: "upstream" });
    vi.mocked(runtime.assertCurrent).mockImplementation(() => {
      throw new Error("source deleted");
    });
    expect(route.assertCurrent).toThrow("source deleted");
  });
});
