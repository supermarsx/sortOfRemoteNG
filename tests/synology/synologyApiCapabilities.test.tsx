import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
import { verifySynologyApiTransportCapabilities } from "../../src/hooks/synology/synologyApiCapabilities";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const seed = {
  host: "fixture.quickconnect.to",
  port: 443,
  useHttps: true,
  username: "fixture-user",
  password: "PRIVATE_PASSWORD",
};
beforeEach(() => {
  vi.mocked(invoke).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("native Synology transport compatibility handshake", () => {
  it.each([
    null,
    {},
    { version: 0, httpProxy: true, quickConnect: true },
    { version: 1, httpProxy: false, quickConnect: true },
    { version: 1, httpProxy: true, quickConnect: "true" },
  ])(
    "refuses unsupported native response before reading vault credentials or sending a NAS request",
    async (response) => {
      vi.mocked(invoke).mockResolvedValue(response);
      const resolveCredentials = vi.fn();
      const { result } = renderHook(() =>
        useSynologyFileConnection(true, {
          initialConfig: seed,
          resolveCredentials,
        }),
      );
      await act(() => result.current.connect());
      expect(resolveCredentials).not.toHaveBeenCalled();
      expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
        "syn_fs_transport_capabilities",
      ]);
      expect(result.current.connectionError).toContain(
        "Restart or update the desktop app",
      );
      expect(result.current.connectionError).not.toContain("PRIVATE_PASSWORD");
    },
  );
  it("does not fall back when an older backend lacks the command", async () => {
    vi.mocked(invoke).mockRejectedValue(
      "Command syn_fs_transport_capabilities not found",
    );
    await expect(verifySynologyApiTransportCapabilities()).rejects.toThrow(
      "No NAS credentials were sent",
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("bounds a missing native reply and clears its timer without starting a login", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockImplementation(() => new Promise(() => {}));
    const reading = verifySynologyApiTransportCapabilities();
    const rejected = expect(reading).rejects.toThrow("Restart or update");
    await vi.advanceTimersByTimeAsync(6000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("does not resolve credentials after the owning hook unmounts during the read-only handshake", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation((command) =>
      command === "syn_fs_transport_capabilities"
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(false),
    );
    const resolveCredentials = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSynologyFileConnection(true, {
        initialConfig: seed,
        resolveCredentials,
      }),
    );
    let connecting!: Promise<void>;
    act(() => {
      connecting = result.current.connect();
    });
    unmount();
    await act(async () => {
      resolve({ version: 1, httpProxy: true, quickConnect: true });
      await connecting;
    });
    expect(resolveCredentials).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "syn_fs_connect"),
    ).toBe(false);
  });
});
