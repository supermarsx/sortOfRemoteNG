import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

import {
  cleanupSessionVpnLeases,
  remainingSessionVpnLeaseOwnerFields,
} from "./sessionVpnLeaseCleanup";

const session: ConnectionSession = {
  id: "frontend-ssh",
  connectionId: "ssh-connection",
  name: "SSH",
  status: "error",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ssh",
  hostname: "ssh.example.test",
  backendSessionId: "native-ssh",
  vpnLeaseOwnerId: "owner-current",
  vpnLeaseOwnerIds: ["owner-previous", "owner-current"],
};

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("session VPN lease cleanup", () => {
  it("deduplicates concurrent cleanup of every persisted owner and permits a later retry", async () => {
    mocks.invoke.mockImplementation(
      (_command: string, args?: { ownerId?: string }) =>
        Promise.resolve({
          owner_id: args?.ownerId,
          released: [],
          errors: [],
        }),
    );

    const [first, second] = await Promise.all([
      cleanupSessionVpnLeases([session]),
      cleanupSessionVpnLeases([session]),
    ]);
    expect(first.releasedOwnerIds).toEqual(["owner-previous", "owner-current"]);
    expect(second).toEqual(first);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);

    await cleanupSessionVpnLeases([session]);
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
  });

  it("retains only unreleased owner ids and promotes one as the legacy primary", () => {
    expect(
      remainingSessionVpnLeaseOwnerFields(session, new Set(["owner-current"])),
    ).toEqual({
      vpnLeaseOwnerId: "owner-previous",
      vpnLeaseOwnerIds: ["owner-previous"],
    });
  });
});
