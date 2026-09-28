import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoveryEndpoints,
  discoveryServiceKey,
} from "../../src/utils/discovery/discoverySelection";
import { useNetworkDiscovery } from "../../src/hooks/network/useNetworkDiscovery";
import { NetworkScanner } from "../../src/utils/network/networkScanner";
import type {
  DiscoveredHost,
  DiscoveredService,
} from "../../src/types/connection/connection";

const { dispatch, saveScan } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  saveScan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ dispatch }),
}));
vi.mock("../../src/hooks/network/useDiscoveryScanHistory", () => ({
  useDiscoveryScanHistory: () => ({ saveScan }),
}));
vi.mock("../../src/hooks/network/useDiscoveryTargets", () => ({
  useDiscoveryTargets: () => ({ remember: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ssh: DiscoveredService = {
  port: 22,
  protocol: "ssh",
  service: "SSH",
  product: "OpenSSH",
};
const https: DiscoveredService = {
  port: 8443,
  protocol: "https",
  service: "HTTPS",
};
const http: DiscoveredService = {
  port: 8443,
  protocol: "http",
  service: "HTTP",
};
const hosts: DiscoveredHost[] = [
  {
    ip: "2001:db8::1",
    hostname: "actual-server",
    responseTime: 1,
    openPorts: [22, 8443],
    services: [ssh, https, http, { ...ssh }],
  },
  {
    ip: "2001:db8::2",
    responseTime: 1,
    openPorts: [22],
    services: [{ ...ssh }],
  },
  { ip: "192.0.2.1", responseTime: 1, openPorts: [], services: [] },
];
beforeEach(() => {
  dispatch.mockClear();
  saveScan.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("endpoint selection identity", () => {
  it("uses an IPv6-safe JSON tuple and isolates host, port and protocol", () => {
    expect(JSON.parse(discoveryServiceKey(hosts[0].ip, ssh))).toEqual([
      "2001:db8::1",
      22,
      "ssh",
    ]);
    expect(
      new Set([
        discoveryServiceKey(hosts[0].ip, ssh),
        discoveryServiceKey(hosts[1].ip, ssh),
        discoveryServiceKey(hosts[0].ip, https),
        discoveryServiceKey(hosts[0].ip, http),
      ]).size,
    ).toBe(4);
    const relabeled = { ...ssh, service: "new label" };
    expect(discoveryServiceKey(hosts[0].ip, relabeled)).toBe(
      discoveryServiceKey(hosts[0].ip, ssh),
    );
  });

  it("resolves only selected observed endpoints and deduplicates repeated services", () => {
    const selected = new Set([
      discoveryServiceKey(hosts[0].ip, https),
      discoveryServiceKey("missing", ssh),
    ]);
    expect(
      discoveryEndpoints(hosts, selected).map(({ host, service }) => [
        host.ip,
        service.protocol,
      ]),
    ).toEqual([[hosts[0].ip, "https"]]);
    expect(discoveryEndpoints([...hosts, hosts[0]])).toHaveLength(4);
    expect(discoveryEndpoints(hosts, new Set())).toEqual([]);
  });

  it("rejects invalid ports without inventing services for bare open ports", () => {
    const invalid = [0, -1, 65536, 22.5, NaN, Infinity].map((port) => ({
      ...ssh,
      port,
    }));
    const result = discoveryEndpoints([
      {
        ...hosts[0],
        services: [...invalid, { ...ssh, port: 1 }, { ...ssh, port: 65535 }],
      },
      { ...hosts[1], services: [] },
    ]);
    expect(result.map(({ service }) => service.port)).toEqual([1, 65535]);
  });
});

async function mountDiscovery(
  allowCreateConnections = true,
  observations = hosts,
) {
  vi.spyOn(NetworkScanner.prototype, "scanNetwork").mockResolvedValue(
    observations,
  );
  const onClose = vi.fn();
  const hook = renderHook(() =>
    useNetworkDiscovery({ native: true, allowCreateConnections, onClose }),
  );
  await act(async () => {
    await hook.result.current.handleScan();
  });
  return { ...hook, onClose };
}

describe("per-service connection creation", () => {
  it("creates only selected services, retaining protocols on a shared port", async () => {
    const { result, onClose } = await mountDiscovery();
    act(() => {
      result.current.toggleServiceSelection(hosts[0].ip, https);
      result.current.toggleServiceSelection(hosts[0].ip, http);
    });
    expect(result.current.selectedServices.size).toBe(2);
    expect([...result.current.selectedHosts]).toEqual([hosts[0].ip]);
    act(() => result.current.handleCreateConnections());
    expect(
      dispatch.mock.calls.map(([action]) => [
        action.payload.hostname,
        action.payload.port,
        action.payload.protocol,
      ]),
    ).toEqual([
      [hosts[0].ip, 8443, "https"],
      [hosts[0].ip, 8443, "http"],
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.selectedServices.size).toBe(0);
  });

  it("host shortcut selects all endpoints from a partial selection, then deselects only that host", async () => {
    const { result } = await mountDiscovery();
    act(() => {
      result.current.toggleServiceSelection(hosts[0].ip, ssh);
      result.current.toggleServiceSelection(hosts[1].ip, ssh);
    });
    act(() => result.current.toggleHostSelection(hosts[0].ip));
    expect(result.current.selectedServices.size).toBe(4);
    act(() => result.current.toggleHostSelection(hosts[0].ip));
    expect([...result.current.selectedServices]).toEqual([
      discoveryServiceKey(hosts[1].ip, ssh),
    ]);
    act(() => result.current.handleCreateConnections());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].payload.hostname).toBe(hosts[1].ip);
  });

  it("row creation validates the supplied endpoint and uses actual discovered metadata", async () => {
    const { result, onClose } = await mountDiscovery();
    act(() => result.current.toggleServiceSelection(hosts[0].ip, https));
    act(() =>
      result.current.handleCreateServiceConnection(
        { ...hosts[0], hostname: "forged" },
        { ...ssh, product: "forged" },
      ),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].payload).toMatchObject({
      hostname: hosts[0].ip,
      port: 22,
      protocol: "ssh",
      name: "actual-server (OpenSSH)",
    });
    expect([...result.current.selectedServices]).toEqual([
      discoveryServiceKey(hosts[0].ip, https),
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown hosts/services, invalid ports and hosts with no services", async () => {
    const { result, onClose } = await mountDiscovery();
    act(() => {
      result.current.toggleHostSelection(hosts[2].ip);
      result.current.toggleServiceSelection("missing", ssh);
      result.current.toggleServiceSelection(hosts[0].ip, { ...ssh, port: 0 });
      result.current.handleCreateServiceConnection(hosts[0], {
        ...ssh,
        protocol: "rdp",
      });
      result.current.handleCreateServiceConnection(
        { ...hosts[0], ip: "missing" },
        ssh,
      );
      result.current.handleCreateConnections();
    });
    expect(result.current.selectedServices.size).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("retains the allowCreateConnections guard for bulk and row actions", async () => {
    const { result, onClose } = await mountDiscovery(false);
    act(() => result.current.toggleHostSelection(hosts[0].ip));
    act(() => {
      result.current.handleCreateConnections();
      result.current.handleCreateServiceConnection(hosts[0], ssh);
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("deduplicates bulk creation and normalizes unknown protocol as before", async () => {
    const unknown = { port: 65000, protocol: "unknown", service: "unknown" };
    const { result } = await mountDiscovery(true, [
      { ...hosts[0], services: [unknown, { ...unknown }] },
    ]);
    act(() => result.current.toggleHostSelection(hosts[0].ip));
    act(() => result.current.handleCreateConnections());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].payload.protocol).toBe("raw");
  });

  it("toggles endpoints independently and clears old selections at the next scan", async () => {
    const { result } = await mountDiscovery();
    act(() => {
      result.current.toggleServiceSelection(hosts[0].ip, ssh);
      result.current.toggleServiceSelection(hosts[0].ip, https);
      result.current.toggleServiceSelection(hosts[0].ip, ssh);
    });
    expect([...result.current.selectedServices]).toEqual([
      discoveryServiceKey(hosts[0].ip, https),
    ]);
    await act(async () => {
      await result.current.handleScan();
    });
    expect(result.current.selectedServices.size).toBe(0);
    expect(result.current.selectedHosts.size).toBe(0);
  });
});
