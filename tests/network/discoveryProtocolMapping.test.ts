import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serviceMap } from "../../src/utils/discovery/serviceMap";
import {
  classifyDiscoveredService,
  NetworkScanner,
  sniffBannerProtocol,
} from "../../src/utils/network/networkScanner";
import { useNetworkDiscovery } from "../../src/hooks/network/useNetworkDiscovery";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";
import type { DiscoveredHost } from "../../src/types/connection/connection";

const { invokeMock, dispatchMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  dispatchMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    dispatch: dispatchMock,
    state: { connections: [] },
  }),
}));

beforeEach(() => {
  invokeMock.mockResolvedValue([]);
});

afterEach(() => {
  invokeMock.mockReset();
  dispatchMock.mockReset();
  vi.restoreAllMocks();
});

const baseConfig: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.0/30",
  portRanges: ["22"],
  protocols: ["ssh"],
  timeout: 100,
  maxConcurrent: 2,
  maxPortConcurrent: 2,
  customPorts: {},
  probeStrategies: { default: ["websocket"] },
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
};

describe("serviceMap port evidence", () => {
  it.each([
    [80, "http"],
    [8080, "http"],
    [8000, "http"],
    [8888, "http"],
    [443, "https"],
    [8443, "https"],
    [9443, "https"],
    [8006, "https"],
    [5985, "winrm"],
    [5986, "winrm"],
    [445, "smb"],
    [177, "xdmcp"],
    [22, "ssh"],
    [3389, "rdp"],
  ])("maps port %d to %s", (port, protocol) => {
    expect(serviceMap[port]?.protocol).toBe(protocol);
  });

  it("only ever maps 3389 to rdp", () => {
    const rdpPorts = Object.entries(serviceMap)
      .filter(([, info]) => info.protocol === "rdp")
      .map(([port]) => Number(port));
    expect(rdpPorts).toEqual([3389]);
  });

  it("leaves extra database ports to the database tasks", () => {
    expect(serviceMap[1433]).toBeUndefined();
    expect(serviceMap[27017]).toBeUndefined();
  });
});

describe("sniffBannerProtocol", () => {
  it.each([
    ["HTTP/1.1 200 OK", undefined, "http"],
    ["HTTP/1.1 200 OK", 8443, "https"],
    ["<!DOCTYPE html><html>", undefined, "http"],
    ["<html><head>", 9999, "http"],
    ["Server: nginx/1.24.0", undefined, "http"],
    ["nginx/1.24.0", undefined, "http"],
    ["Apache/2.4.57 (Debian)", undefined, "http"],
    ["Microsoft-IIS/10.0", undefined, "http"],
    ["\x16\x03\x01\x02\x00\x01", undefined, "https"],
    ["\x16\x03\x03", 9999, "https"],
  ])("classifies banner %j (port %s) as %s", (banner, port, expected) => {
    expect(sniffBannerProtocol(banner, port)).toBe(expected);
  });

  it.each([
    ["SSH-2.0-OpenSSH_9.6"],
    ["RFB 003.008"],
    ["220 mail.example.com ESMTP"],
    [""],
    [undefined],
  ])("returns undefined for non-web banner %j", (banner) => {
    expect(sniffBannerProtocol(banner as string | undefined)).toBeUndefined();
  });
});

describe("classifyDiscoveredService", () => {
  it.each([
    [80, "http"],
    [8080, "http"],
    [443, "https"],
    [8443, "https"],
    [22, "ssh"],
    [3389, "rdp"],
    [5985, "winrm"],
  ])("port %d without banner → %s", (port, protocol) => {
    const service = classifyDiscoveredService(port);
    expect(service.protocol).toBe(protocol);
    expect(service.service).toBe(serviceMap[port].service);
  });

  it("reports an unknown port with no banner as raw, not rdp", () => {
    const service = classifyDiscoveredService(9999);
    expect(service).toEqual({
      port: 9999,
      protocol: "raw",
      service: "unknown",
      banner: undefined,
    });
  });

  it("uses banner evidence on an unknown port before giving up", () => {
    expect(
      classifyDiscoveredService(9999, "HTTP/1.0 401 Unauthorized"),
    ).toMatchObject({
      protocol: "http",
      service: "http",
    });
    expect(classifyDiscoveredService(9999, "\x16\x03\x01")).toMatchObject({
      protocol: "https",
      service: "https",
    });
    const nginx = classifyDiscoveredService(7777, "nginx/1.24.0");
    expect(nginx.protocol).toBe("http");
    expect(nginx.version).toBe("1.24.0");
  });

  it("a static service-map hit outranks the banner", () => {
    expect(classifyDiscoveredService(22, "HTTP/1.1 200 OK").protocol).toBe(
      "ssh",
    );
  });

  it("keeps the vnc hint contract", () => {
    const service = classifyDiscoveredService(5999, "RFB 003.008", "vnc");
    expect(service).toMatchObject({
      protocol: "vnc",
      service: "vnc",
      version: "003.008",
    });
  });

  it("never yields rdp for any port other than 3389 without a hint", () => {
    const ports = [
      21, 80, 81, 443, 445, 1433, 4444, 5000, 5985, 8080, 8443, 27017, 65000,
    ];
    for (const port of ports) {
      expect(classifyDiscoveredService(port).protocol).not.toBe("rdp");
    }
  });
});

describe("NetworkScanner.getProtocolForPort", () => {
  const scanner = new NetworkScanner() as unknown as {
    getProtocolForPort: (
      port: number,
      config: NetworkDiscoveryConfig,
    ) => string;
    identifyService: (
      port: number,
      banner?: string,
      hint?: string,
    ) => { protocol: string };
  };

  it("prefers configured custom ports", () => {
    const config = {
      ...baseConfig,
      protocols: ["ssh"],
      customPorts: { ssh: [2222] },
    };
    expect(scanner.getProtocolForPort(2222, config)).toBe("ssh");
  });

  it("falls back to the service map and normaliser port table", () => {
    expect(scanner.getProtocolForPort(8080, baseConfig)).toBe("http");
    expect(scanner.getProtocolForPort(8443, baseConfig)).toBe("https");
  });

  it("returns the generic probe strategy key for unknown ports, never rdp", () => {
    expect(scanner.getProtocolForPort(9999, baseConfig)).toBe("default");
    expect(scanner.getProtocolForPort(4444, baseConfig)).not.toBe("rdp");
  });

  it("identifyService delegates to the pure classifier", () => {
    expect(scanner.identifyService(9999).protocol).toBe("raw");
    expect(scanner.identifyService(8443).protocol).toBe("https");
  });
});

describe("useNetworkDiscovery.handleCreateConnections", () => {
  it("creates connections whose protocol follows port evidence (never rdp by default)", async () => {
    const hosts: DiscoveredHost[] = [
      {
        ip: "192.0.2.10",
        hostname: "portal",
        openPorts: [8443, 8080, 9999, 3389, 25],
        responseTime: 1,
        services: [
          { port: 8443, protocol: "https", service: "https" },
          { port: 8080, protocol: "http", service: "http" },
          // Legacy scanner output shape: unknown protocol string.
          { port: 9999, protocol: "unknown", service: "unknown" },
          { port: 3389, protocol: "rdp", service: "rdp" },
          // Service without an app protocol: port 25 has no evidence → raw.
          { port: 25, protocol: "smtp", service: "smtp" },
        ],
      },
    ];
    vi.spyOn(NetworkScanner.prototype, "scanNetwork").mockResolvedValue(hosts);
    const onClose = vi.fn();
    const { result } = renderHook(() => useNetworkDiscovery({ onClose }));

    await act(async () => {
      await result.current.handleScan();
    });
    expect(result.current.discoveredHosts).toHaveLength(1);

    act(() => {
      result.current.toggleHostSelection("192.0.2.10");
    });
    act(() => {
      result.current.handleCreateConnections();
    });

    const created = dispatchMock.mock.calls
      .filter(([action]) => action.type === "ADD_CONNECTION")
      .map(([action]) => action.payload);
    const byPort = Object.fromEntries(created.map((c) => [c.port, c.protocol]));
    expect(byPort).toEqual({
      8443: "https",
      8080: "http",
      9999: "raw",
      3389: "rdp",
      25: "raw",
    });
    expect(created.every((c) => c.hostname === "192.0.2.10")).toBe(true);
    expect(created.every((c) => c.isGroup === false)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
