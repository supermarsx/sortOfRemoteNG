import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  acquireSessionVpnLeases,
  createVpnLeaseAttemptOwnerId,
  releaseSessionVpnLeases,
  vpnLeaseCleanupError,
} from "../../src/utils/network/vpnSessionLeases";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("session VPN lease IPC", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("acquires the complete ordered path in one backend transaction", async () => {
    vi.mocked(invoke).mockResolvedValue({
      owner_id: "session-1",
      leases: [],
    });

    await acquireSessionVpnLeases("session-1", [
      { vpnType: "wireguard", connectionId: "wg-office" },
      { vpnType: "tailscale", connectionId: "tailnet" },
    ]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("acquire_vpn_leases", {
      ownerId: "session-1",
      requests: [
        {
          vpn_type: "wireguard",
          connection_id: "wg-office",
          auto_connect: true,
        },
        {
          vpn_type: "tailscale",
          connection_id: "tailnet",
          auto_connect: true,
        },
      ],
    });
  });

  it("does not invoke lifecycle state for a direct path", async () => {
    await expect(acquireSessionVpnLeases("session-1", [])).resolves.toEqual({
      owner_id: "session-1",
      leases: [],
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("preserves every product-eligible legacy provider in request order", async () => {
    vi.mocked(invoke).mockResolvedValue({
      owner_id: "session-legacy",
      leases: [],
    });

    await acquireSessionVpnLeases("session-legacy", [
      { vpnType: "pptp", connectionId: "pptp-office" },
      { vpnType: "l2tp", connectionId: "l2tp-office" },
      { vpnType: "ikev2", connectionId: "ike-office" },
      { vpnType: "ipsec", connectionId: "ipsec-office" },
      { vpnType: "sstp", connectionId: "sstp-office" },
    ]);

    expect(invoke).toHaveBeenCalledWith("acquire_vpn_leases", {
      ownerId: "session-legacy",
      requests: [
        {
          vpn_type: "pptp",
          connection_id: "pptp-office",
          auto_connect: true,
        },
        {
          vpn_type: "l2tp",
          connection_id: "l2tp-office",
          auto_connect: true,
        },
        {
          vpn_type: "ikev2",
          connection_id: "ike-office",
          auto_connect: true,
        },
        {
          vpn_type: "ipsec",
          connection_id: "ipsec-office",
          auto_connect: true,
        },
        {
          vpn_type: "sstp",
          connection_id: "sstp-office",
          auto_connect: true,
        },
      ],
    });
  });

  it("rejects SoftEther before invoking backend lifecycle state", async () => {
    await expect(
      acquireSessionVpnLeases("session-1", [
        { vpnType: "softether", connectionId: "softether-office" } as any,
      ]),
    ).rejects.toThrow(/SoftEther is not executable/i);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("releases all owner leases through the idempotent cleanup command", async () => {
    vi.mocked(invoke).mockResolvedValue({
      owner_id: "session-1",
      released: [],
      errors: [],
    });

    await releaseSessionVpnLeases("session-1");

    expect(invoke).toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: "session-1",
    });
  });

  it("surfaces provider cleanup failures for disconnect UX", () => {
    expect(
      vpnLeaseCleanupError({
        owner_id: "session-1",
        released: [],
        errors: ["WireGuard remained active", "OpenVPN process is busy"],
      }),
    ).toBe("WireGuard remained active; OpenVPN process is busy");
  });

  it("isolates an overlapping stale attempt from its replacement owner", async () => {
    const staleOwner = createVpnLeaseAttemptOwnerId("rdp-session", "rdp");
    const replacementOwner = createVpnLeaseAttemptOwnerId("rdp-session", "rdp");
    const liveOwners = new Set<string>();
    let allowStaleRelease!: () => void;
    const staleReleaseGate = new Promise<void>((resolve) => {
      allowStaleRelease = resolve;
    });

    vi.mocked(invoke).mockImplementation(
      async (command: string, args?: unknown) => {
        const invokeArgs = args as Record<string, unknown> | undefined;
        const ownerId = String(invokeArgs?.ownerId);
        if (command === "acquire_vpn_leases") {
          liveOwners.add(ownerId);
          return { owner_id: ownerId, leases: [] };
        }
        if (command === "release_vpn_leases") {
          if (ownerId === staleOwner) await staleReleaseGate;
          liveOwners.delete(ownerId);
          return { owner_id: ownerId, released: [], errors: [] };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    );

    const step = [{ vpnType: "wireguard" as const, connectionId: "office" }];
    await acquireSessionVpnLeases(staleOwner, step);
    const staleCleanup = releaseSessionVpnLeases(staleOwner);
    await acquireSessionVpnLeases(replacementOwner, step);
    allowStaleRelease();
    await staleCleanup;

    expect(staleOwner).not.toBe(replacementOwner);
    expect(liveOwners).toEqual(new Set([replacementOwner]));
  });

  it("keeps owner ids unique across module reloads and renderer scopes", async () => {
    const first = createVpnLeaseAttemptOwnerId("shared-session", "ssh");
    vi.resetModules();
    const reloaded = await import("../../src/utils/network/vpnSessionLeases");
    const second = reloaded.createVpnLeaseAttemptOwnerId(
      "shared-session",
      "ssh",
    );
    const detached = reloaded.createVpnLeaseAttemptOwnerId(
      "shared-session",
      "rdp",
    );

    expect(first).toMatch(/^shared-session:ssh:/);
    expect(second).toMatch(/^shared-session:ssh:/);
    expect(detached).toMatch(/^shared-session:rdp:/);
    expect(new Set([first, second, detached]).size).toBe(3);
  });
});
