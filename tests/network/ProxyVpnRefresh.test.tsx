import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  chains: vi.fn(),
  catalog: vi.fn(),
  listen: vi.fn(),
  profiles: [] as unknown[],
  savedChains: [] as unknown[],
  tunnels: [] as unknown[],
  tunnelChains: [] as unknown[],
  tunnelProfiles: [] as unknown[],
  collectionListeners: new Set<() => void>(),
  tunnelListeners: new Set<() => void>(),
  manager: {} as { listConnectionChains: () => Promise<unknown[]> },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen }));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { connections: [] }, dispatch: vi.fn() }),
}));
vi.mock("../../src/utils/network/proxyOpenVPNManager", () => ({
  ProxyOpenVPNManager: { getInstance: () => h.manager },
}));
vi.mock("../../src/utils/network/vpnProfiles", () => ({
  loadVpnProfileCatalog: h.catalog,
}));
vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    getProfiles: () => h.profiles,
    getChains: () => h.savedChains,
    getTunnelChains: () => h.tunnelChains,
    getTunnelProfiles: () => h.tunnelProfiles,
    subscribe: (fn: () => void) => {
      h.collectionListeners.add(fn);
      return () => h.collectionListeners.delete(fn);
    },
  },
}));
vi.mock("../../src/utils/ssh/sshTunnelService", () => ({
  sshTunnelService: {
    getTunnels: () => h.tunnels,
    subscribe: (fn: () => void) => {
      h.tunnelListeners.add(fn);
      return () => h.tunnelListeners.delete(fn);
    },
  },
}));
import { useProxyChainManager } from "../../src/hooks/network/useProxyChainManager";
import { useVpnManager } from "../../src/hooks/network/useVpnManager";
import { useTunnelChainManager } from "../../src/hooks/network/useTunnelChainManager";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const visible = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.collectionListeners.clear();
  h.tunnelListeners.clear();
  h.profiles = [];
  h.savedChains = [];
  h.tunnels = [];
  h.tunnelChains = [];
  h.tunnelProfiles = [];
  h.manager = { listConnectionChains: h.chains };
  h.chains.mockResolvedValue([]);
  h.invoke.mockResolvedValue([]);
  h.catalog.mockResolvedValue({
    profiles: [],
    providerStatus: { openvpn: "loaded" },
  });
  h.listen.mockResolvedValue(vi.fn());
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});

describe("visible proxy and VPN refresh", () => {
  it("reads local profile/tunnel updates immediately without network refresh and retains equal snapshots", async () => {
    const { result, unmount } = renderHook(() =>
      useProxyChainManager(true, vi.fn()),
    );
    await settle();
    const unchanged = result.current.savedProfiles;
    act(() => {
      for (const listener of h.collectionListeners) listener();
    });
    expect(result.current.savedProfiles).toBe(unchanged);
    h.profiles = [{ id: "profile", name: "New saved profile" }];
    h.tunnels = [{ id: "tunnel", status: "connected" }];
    act(() => {
      for (const listener of h.collectionListeners) listener();
      for (const listener of h.tunnelListeners) listener();
    });
    expect(result.current.savedProfiles).toEqual(h.profiles);
    expect(result.current.sshTunnels).toEqual(h.tunnels);
    expect(h.chains).toHaveBeenCalledTimes(1);
    await tick(15_000);
    expect(h.chains).toHaveBeenCalledTimes(2);
    expect(result.current.isLoading).toBe(false);
    unmount();
    expect(h.collectionListeners.size).toBe(0);
    expect(h.tunnelListeners.size).toBe(0);
  });
  it("coalesces proxy refreshes and refuses stale completion after inactive→active", async () => {
    const pending = deferred<unknown[]>();
    h.chains.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(
      ({ active }) => useProxyChainManager(active, vi.fn()),
      { initialProps: { active: true } },
    );
    act(() => {
      void result.current.reloadChains();
      void result.current.reloadChains();
    });
    expect(h.chains).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    rerender({ active: true });
    await act(async () =>
      pending.resolve([{ id: "stale", name: "Old", status: "connected" }]),
    );
    await settle();
    expect(result.current.connectionChains).toEqual([]);
    expect(h.chains).toHaveBeenCalledTimes(2);
    expect(result.current.isLoading).toBe(false);
    rerender({ active: false });
    await tick(60_000);
    expect(h.chains).toHaveBeenCalledTimes(2);
  });
  it("observes in-place service updates without losing owned snapshot equality", async () => {
    const tunnel = {
      id: "tunnel",
      status: "disconnected",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    const profile = {
      id: "profile",
      isDefault: true,
      config: { host: "original" },
    };
    h.tunnels = [tunnel];
    h.profiles = [profile];
    const { result } = renderHook(() => useProxyChainManager(true, vi.fn()));
    await settle();
    const oldTunnels = result.current.sshTunnels;
    const oldProfiles = result.current.savedProfiles;
    tunnel.status = "connected";
    profile.isDefault = false;
    profile.config.host = "updated";
    act(() => {
      for (const listener of h.tunnelListeners) listener();
    });
    expect(result.current.sshTunnels[0].status).toBe("connected");
    expect(oldTunnels[0].status).toBe("disconnected");
    expect(result.current.savedProfiles[0].isDefault).toBe(false);
    expect(oldProfiles[0].isDefault).toBe(true);
    const current = result.current.sshTunnels;
    act(() => {
      for (const listener of h.tunnelListeners) listener();
    });
    expect(result.current.sshTunnels).toBe(current);
  });
  it("pauses document-hidden polling and resumes with one read, retaining last good rows on failure", async () => {
    h.chains.mockResolvedValue([
      { id: "good", name: "Good", status: "connected" },
    ]);
    const { result } = renderHook(() => useProxyChainManager(true, vi.fn()));
    await settle();
    act(() => visible(true));
    await tick(60_000);
    expect(h.chains).toHaveBeenCalledTimes(1);
    h.chains.mockRejectedValueOnce(new Error("synthetic unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => visible(false));
    await settle();
    expect(result.current.connectionChains[0].id).toBe("good");
    expect(result.current.isLoading).toBe(false);
    log.mockRestore();
  });
  it("coalesces VPN events and cleans asynchronous listener registration after deactivation", async () => {
    const pending = deferred<unknown>();
    const registration = deferred<() => void>();
    h.catalog.mockReturnValueOnce(pending.promise);
    h.listen.mockReturnValueOnce(registration.promise);
    const { result, rerender } = renderHook(
      ({ active }) => useVpnManager(active),
      { initialProps: { active: true } },
    );
    const callback = h.listen.mock.calls[0][1];
    act(() => {
      callback();
      callback();
      callback();
    });
    expect(h.catalog).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    const unlisten = vi.fn();
    await act(async () => registration.resolve(unlisten));
    expect(unlisten).toHaveBeenCalledOnce();
    await act(async () =>
      pending.resolve({
        profiles: [{ id: "stale" }],
        providerStatus: { openvpn: "loaded" },
      }),
    );
    expect(result.current.connections).toEqual([]);
    rerender({ active: true });
    await settle();
    expect(result.current.isLoading).toBe(false);
    expect(h.catalog).toHaveBeenCalledTimes(2);
    await tick(10_000);
    expect(h.catalog).toHaveBeenCalledTimes(3);
  });
  it("retains VPN rows for a failed provider while marking its capability unverified", async () => {
    const profile = {
      id: "vpn",
      name: "Fixture",
      vpnType: "openvpn",
      status: "connected",
    };
    h.catalog.mockResolvedValueOnce({
      profiles: [profile],
      providerStatus: { openvpn: "loaded" },
    });
    h.listen.mockRejectedValueOnce(new Error("no browser event bridge"));
    const { result } = renderHook(() => useVpnManager(true));
    await settle();
    h.catalog.mockResolvedValue({
      profiles: [],
      providerStatus: { openvpn: "error" },
      providerErrors: { openvpn: "Unavailable" },
    });
    await tick(10_000);
    expect(result.current.connections).toEqual([profile]);
    expect(result.current.profileCatalog?.providerStatus.openvpn).toBe("error");
    expect(result.current.error).toContain("Could not load");
    expect(result.current.isLoading).toBe(false);
  });
  it("refreshes tunnel status from the current local collection, rejects hidden completion and reuses Maps", async () => {
    h.tunnelChains = [{ id: "chain", name: "Fixture", layers: [] }];
    const pending = deferred<unknown[]>();
    h.invoke.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useTunnelChainManager(true));
    act(() => visible(true));
    await act(async () =>
      pending.resolve([
        { id: "stale", name: "adhoc:chain", status: "Connected" },
      ]),
    );
    expect(result.current.activeStatuses.size).toBe(0);
    h.invoke.mockResolvedValue([
      { id: "current", name: "adhoc:chain", status: "Connected" },
    ]);
    act(() => visible(false));
    await settle();
    expect(result.current.activeStatuses.get("chain")?.backendChainId).toBe(
      "current",
    );
    const previous = result.current.activeStatuses;
    await tick(10_000);
    expect(result.current.activeStatuses).toBe(previous);
    h.tunnelChains = [];
    act(() => {
      for (const listener of h.collectionListeners) listener();
    });
    await settle();
    expect(result.current.activeStatuses.size).toBe(0);
  });
});
