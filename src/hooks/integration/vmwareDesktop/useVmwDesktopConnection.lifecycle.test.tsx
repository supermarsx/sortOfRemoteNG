import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invokeMock(command, args),
}));

import { useVmwDesktopConnection } from "./useVmwDesktopConnection";

describe("useVmwDesktopConnection process-global ownership", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "vmwd_connect") {
        return Promise.resolve({
          product: "workstation_pro",
          productVersion: "17.5",
          vmrunAvailable: true,
          vmrestAvailable: true,
          vmCount: 2,
        });
      }
      if (command === "vmwd_host_info") {
        return Promise.resolve({
          product: "workstation_pro",
          vmrestAvailable: true,
          os: "windows",
          networkTypes: [],
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it("keeps cold refresh/disconnect inert and retains ownership after failed cleanup", async () => {
    const { result } = renderHook(() => useVmwDesktopConnection());

    await act(async () => {
      await result.current.refreshStatus();
      await result.current.disconnect();
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "vmwd_is_connected",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "vmwd_disconnect",
      expect.anything(),
    );

    await act(async () => {
      await result.current.connect({
        vmrestHost: "127.0.0.1",
        vmrestPort: 8697,
      });
    });
    expect(result.current.connected).toBe(true);

    invokeMock.mockRejectedValueOnce(new Error("native disconnect failed"));
    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.error).toMatch(/native disconnect failed/i);

    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.connected).toBe(false);
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "vmwd_disconnect",
      ),
    ).toHaveLength(2);
  });
});
