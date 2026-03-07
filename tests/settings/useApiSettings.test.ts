import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useApiSettings } from "../../src/hooks/settings/useApiSettings";
import type { GlobalSettings } from "../../src/types/settings/settings";

function makeSettings(overrides: Partial<GlobalSettings["restApi"]> = {}): GlobalSettings {
  return {
    restApi: {
      enabled: false,
      port: 9876,
      useRandomPort: false,
      authentication: true,
      apiKey: "test-key-123",
      corsEnabled: false,
      rateLimiting: true,
      startOnLaunch: false,
      allowRemoteConnections: false,
      sslEnabled: false,
      sslMode: "self-signed",
      maxRequestsPerMinute: 60,
      maxThreads: 4,
      requestTimeout: 30,
      ...overrides,
    },
  } as GlobalSettings;
}

describe("useApiSettings", () => {
  it("returns initial stopped status", () => {
    const update = vi.fn();
    const { result } = renderHook(() => useApiSettings(makeSettings(), update));

    expect(result.current.serverStatus).toBe("stopped");
    expect(result.current.actualPort).toBeNull();
  });

  it("updateRestApi merges updates", () => {
    const update = vi.fn();
    const settings = makeSettings();
    const { result } = renderHook(() => useApiSettings(settings, update));

    act(() => {
      result.current.updateRestApi({ port: 1234 });
    });

    expect(update).toHaveBeenCalledWith({
      restApi: { ...settings.restApi, port: 1234 },
    });
  });

  it("generateApiKey produces a 64-char hex key", () => {
    const update = vi.fn();
    const { result } = renderHook(() => useApiSettings(makeSettings(), update));

    act(() => {
      result.current.generateApiKey();
    });

    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0][0] as { restApi: { apiKey: string } };
    expect(call.restApi.apiKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generateRandomPort sets port between 10000-60000", () => {
    const update = vi.fn();
    const { result } = renderHook(() => useApiSettings(makeSettings(), update));

    act(() => {
      result.current.generateRandomPort();
    });

    const call = update.mock.calls[0][0] as { restApi: { port: number } };
    expect(call.restApi.port).toBeGreaterThanOrEqual(10000);
    expect(call.restApi.port).toBeLessThan(60000);
  });

  it("handleStartServer transitions to running", async () => {
    const update = vi.fn();
    const { result } = renderHook(() => useApiSettings(makeSettings(), update));

    await act(async () => {
      await result.current.handleStartServer();
    });

    expect(result.current.serverStatus).toBe("running");
    expect(result.current.actualPort).toBe(9876);
  });

  it("handleStopServer transitions to stopped", async () => {
    const update = vi.fn();
    const { result } = renderHook(() => useApiSettings(makeSettings(), update));

    await act(async () => {
      await result.current.handleStartServer();
    });
    expect(result.current.serverStatus).toBe("running");

    await act(async () => {
      await result.current.handleStopServer();
    });

    expect(result.current.serverStatus).toBe("stopped");
    expect(result.current.actualPort).toBeNull();
  });

  it("handleStartServer with useRandomPort assigns random port", async () => {
    const update = vi.fn();
    const settings = makeSettings({ useRandomPort: true });
    const { result } = renderHook(() => useApiSettings(settings, update));

    await act(async () => {
      await result.current.handleStartServer();
    });

    expect(result.current.actualPort).toBeGreaterThanOrEqual(10000);
    expect(result.current.actualPort).toBeLessThan(60000);
  });
});
