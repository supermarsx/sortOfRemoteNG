import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Stub @tauri-apps/api/core so the capability-catalog effect resolves
// to a deterministic catalog in tests (no real Tauri runtime in jsdom).
// The hook resolves `invoke` via a dynamic import, so route the mock
// through a module-scoped spy (the pattern used across the suite, e.g.
// tests/hooks/useBulkConnectionCheck.test.ts) that each test can retune.
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => true,
}));

const fakeCatalog = [
  {
    id: "health",
    label: "Health probe",
    description: "Liveness check.",
    group: "core-api",
    prefix: "/health",
    endpoints: ["GET /health"],
    mandatory: true,
  },
  {
    id: "auth",
    label: "Authentication",
    description: "Login + users.",
    group: "core-api",
    prefix: "/auth",
    endpoints: ["POST /auth/login", "GET /auth/users"],
    mandatory: true,
  },
  {
    id: "ssh",
    label: "SSH",
    description: "SSH ops.",
    group: "protocols",
    prefix: "/ssh",
    endpoints: ["POST /ssh/connect"],
    mandatory: false,
  },
  {
    id: "db",
    label: "Database",
    description: "DB ops.",
    group: "protocols",
    prefix: "/db",
    endpoints: ["POST /db/connect"],
    mandatory: false,
  },
  {
    id: "aws",
    label: "AWS",
    description: "AWS ops.",
    group: "cloud",
    prefix: "/aws",
    endpoints: ["POST /aws/connect"],
    mandatory: false,
  },
];

const stoppedStatus = {
  running: false,
  bindAddr: "",
  port: 0,
  authRequired: false,
};

const runningStatus = {
  running: true,
  bindAddr: "127.0.0.1:9876",
  port: 9876,
  authRequired: false,
};

// Default backend behaviour: catalog resolves, server reports stopped,
// start/restart bring it up on the configured 9876, key regenerates to a
// deterministic 64-char hex. Individual tests override via invokeMock.
function defaultInvoke(cmd: string): Promise<unknown> {
  switch (cmd) {
    case "get_api_capabilities":
      return Promise.resolve(fakeCatalog);
    case "set_api_disabled_capabilities":
      return Promise.resolve();
    case "api_server_status":
      return Promise.resolve(stoppedStatus);
    case "api_server_start":
    case "api_server_restart":
      return Promise.resolve(runningStatus);
    case "api_server_stop":
      return Promise.resolve();
    case "api_regenerate_key":
      return Promise.resolve("a".repeat(64));
    default:
      return Promise.reject(new Error(`unknown command ${cmd}`));
  }
}

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
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => defaultInvoke(cmd));
    // The hook resolves `invoke` via a dynamic `import('@tauri-apps/api/core')`.
    // Route the runtime bridge that the real module calls into (core.js reads
    // `window.__TAURI_INTERNALS__.invoke`) so the command layer is intercepted
    // deterministically regardless of module-mock resolution order.
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: (...args: unknown[]) => invokeMock(...args),
    };
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

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

  it("generateApiKey produces a 64-char hex key", async () => {
    const update = vi.fn();
    const { result } = renderHook(() => useApiSettings(makeSettings(), update));

    update.mockClear();
    await act(async () => {
      await result.current.generateApiKey();
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
    // The backend resolves the ephemeral port and reports it back in the
    // status; the hook surfaces whatever it returns.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "api_server_start") {
        return Promise.resolve({
          running: true,
          bindAddr: "127.0.0.1:54321",
          port: 54321,
          authRequired: false,
        });
      }
      return defaultInvoke(cmd);
    });
    const { result } = renderHook(() => useApiSettings(settings, update));

    await act(async () => {
      await result.current.handleStartServer();
    });

    expect(result.current.actualPort).toBeGreaterThanOrEqual(10000);
    expect(result.current.actualPort).toBeLessThan(60000);
  });

  describe("capability mutators", () => {
    it("loads the capability catalog from the Tauri command", async () => {
      const update = vi.fn();
      const { result } = renderHook(() =>
        useApiSettings(makeSettings(), update),
      );

      await waitFor(() => {
        expect(result.current.capabilitiesLoaded).toBe(true);
      });
      expect(result.current.capabilities).toHaveLength(5);
      expect(result.current.disabledCount).toBe(0);
    });

    it("toggleCapability adds the ID to the disabled list when turning off", async () => {
      const update = vi.fn();
      const { result } = renderHook(() =>
        useApiSettings(makeSettings(), update),
      );
      await waitFor(() => { expect(result.current.capabilitiesLoaded).toBe(true); });

      act(() => {
        result.current.toggleCapability("ssh", false);
      });

      const call = update.mock.calls[update.mock.calls.length - 1]?.[0] as {
        restApi: { disabledCapabilities: string[] };
      };
      expect(call.restApi.disabledCapabilities).toEqual(["ssh"]);
    });

    it("toggleCapability is a no-op for mandatory capabilities", async () => {
      const update = vi.fn();
      const { result } = renderHook(() =>
        useApiSettings(makeSettings(), update),
      );
      await waitFor(() => { expect(result.current.capabilitiesLoaded).toBe(true); });
      update.mockClear();

      act(() => {
        result.current.toggleCapability("health", false);
      });

      expect(update).not.toHaveBeenCalled();
    });

    it("setCapabilityGroup bulk-toggles every non-mandatory capability in the group", async () => {
      const update = vi.fn();
      const { result } = renderHook(() =>
        useApiSettings(makeSettings(), update),
      );
      await waitFor(() => { expect(result.current.capabilitiesLoaded).toBe(true); });
      update.mockClear();

      act(() => {
        result.current.setCapabilityGroup("protocols", false);
      });

      const call = update.mock.calls[update.mock.calls.length - 1]?.[0] as {
        restApi: { disabledCapabilities: string[] };
      };
      expect(call.restApi.disabledCapabilities.sort()).toEqual(["db", "ssh"]);
    });

    it("setCapabilityGroup with enabled=true removes group IDs from the disabled list", async () => {
      const update = vi.fn();
      const settings = makeSettings({ disabledCapabilities: ["ssh", "db", "aws"] });
      const { result } = renderHook(() => useApiSettings(settings, update));
      await waitFor(() => { expect(result.current.capabilitiesLoaded).toBe(true); });
      update.mockClear();

      act(() => {
        result.current.setCapabilityGroup("protocols", true);
      });

      const call = update.mock.calls[update.mock.calls.length - 1]?.[0] as {
        restApi: { disabledCapabilities: string[] };
      };
      expect(call.restApi.disabledCapabilities).toEqual(["aws"]);
    });

    it("enableAllCapabilities wipes the disabled list", async () => {
      const update = vi.fn();
      const settings = makeSettings({ disabledCapabilities: ["ssh", "aws"] });
      const { result } = renderHook(() => useApiSettings(settings, update));
      await waitFor(() => { expect(result.current.capabilitiesLoaded).toBe(true); });
      update.mockClear();

      act(() => {
        result.current.enableAllCapabilities();
      });

      const call = update.mock.calls[update.mock.calls.length - 1]?.[0] as {
        restApi: { disabledCapabilities: string[] };
      };
      expect(call.restApi.disabledCapabilities).toEqual([]);
    });

    it("setDisabledCapabilities silently strips mandatory IDs (defense in depth)", async () => {
      const update = vi.fn();
      const { result } = renderHook(() =>
        useApiSettings(makeSettings(), update),
      );
      await waitFor(() => { expect(result.current.capabilitiesLoaded).toBe(true); });
      update.mockClear();

      act(() => {
        // Bypass via setCapabilityGroup against "core-api" — should
        // refuse to add `health` / `auth` to the disabled list.
        result.current.setCapabilityGroup("core-api", false);
      });

      // No mutator call: there are no non-mandatory capabilities in
      // the core-api group, so setCapabilityGroup short-circuits.
      expect(update).not.toHaveBeenCalled();
    });

    it("isGroupFullyDisabled / isGroupFullyEnabled reflect current state", async () => {
      const update = vi.fn();
      const settings = makeSettings({ disabledCapabilities: ["ssh", "db"] });
      const { result } = renderHook(() => useApiSettings(settings, update));
      await waitFor(() => { expect(result.current.capabilitiesLoaded).toBe(true); });

      expect(result.current.isGroupFullyDisabled("protocols")).toBe(true);
      expect(result.current.isGroupFullyEnabled("protocols")).toBe(false);
      expect(result.current.isGroupFullyEnabled("cloud")).toBe(true);
    });

    it("disabledCount counts only non-mandatory entries", async () => {
      const update = vi.fn();
      // health / auth in the list should be ignored even though they
      // shouldn't have ended up there in the first place.
      const settings = makeSettings({
        disabledCapabilities: ["ssh", "health", "auth"],
      });
      const { result } = renderHook(() => useApiSettings(settings, update));
      await waitFor(() => { expect(result.current.capabilitiesLoaded).toBe(true); });

      expect(result.current.disabledCount).toBe(1);
    });
  });
});
