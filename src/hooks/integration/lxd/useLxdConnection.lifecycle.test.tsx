import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invokeMock(command, args),
}));

import { useLxdConnection } from "./useLxdConnection";

describe("useLxdConnection process-global ownership", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "lxd_connect") {
        return Promise.resolve({
          connected: true,
          serverUrl: "https://lxd.example.test:8443",
          project: "default",
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it("keeps cold refresh/disconnect inert and retains ownership after failed cleanup", async () => {
    const { result } = renderHook(() => useLxdConnection());

    await act(async () => {
      await expect(result.current.refreshStatus()).resolves.toBe(false);
      await result.current.disconnect();
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "lxd_is_connected",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "lxd_disconnect",
      expect.anything(),
    );

    await act(async () => {
      await expect(
        result.current.connect({
          url: "https://lxd.example.test:8443",
          skipTlsVerify: false,
          project: "default",
          timeoutSecs: 30,
        }),
      ).resolves.toMatchObject({ connected: true });
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
      invokeMock.mock.calls.filter(([command]) => command === "lxd_disconnect"),
    ).toHaveLength(2);
  });
});
