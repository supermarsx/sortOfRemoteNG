import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  ArdEmbeddedAuthMode,
  ArdNativeHandoffResult,
  ArdRuntimeCapabilities,
  ArdStatusEvent,
} from "../../types/protocols/ard";
import { ardDisplayError, useArdClient } from "./useArdClient";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn(),
  useConnections: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class<T> {
    onmessage: (message: T) => void;

    constructor(onmessage: (message: T) => void) {
      this.onmessage = onmessage;
    }
  },
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

const savedPassword = "embedded-password-must-never-be-displayed";
const appleAccountIdentifier = "person@example.test";
const connection = {
  id: "ard-connection-1",
  name: "Family Mac",
  protocol: "ard",
  hostname: "family-mac.local",
  port: 5900,
  password: savedPassword,
  isGroup: false,
  ardSettings: {
    version: 2,
    authMode: "appleAccountNative",
    appleAccountIdentifier,
    autoReconnect: true,
    curtainOnConnect: false,
    localCursor: true,
    viewOnly: false,
  },
} as unknown as Connection;

const session: ConnectionSession = {
  id: "ard-frontend-session-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ard",
  hostname: connection.hostname,
};

const capabilities: ArdRuntimeCapabilities = {
  embeddedRfb: {
    available: true,
    authenticationModes: ["macOsAccount", "vncPassword"],
    acceptsAppleAccountCredentials: false,
    supportsNetworkPath: false,
    networkPathReason: "direct only",
  },
  appleAccountNative: {
    available: true,
    requiresMacOs: true,
    acceptsPassword: false,
    targetPrefillSupported: false,
    reason: "Authentication remains in Screen Sharing.",
  },
};

const handoff: ArdNativeHandoffResult = {
  applicationOpened: true,
  application: "Screen Sharing",
  platform: "macos",
  connectionEstablished: false,
  acceptsPassword: false,
  targetPrefilled: false,
};

const createFallbackConnection = (
  authMode: ArdEmbeddedAuthMode = "macOsAccount",
  enabled = true,
): Connection =>
  ({
    ...connection,
    username: "remote-mac-user",
    ardSettings: {
      version: 3,
      authMode: "appleAccountNative",
      appleAccountIdentifier,
      crossPlatformFallback: { enabled, authMode },
      autoReconnect: true,
      curtainOnConnect: false,
      localCursor: true,
      viewOnly: false,
    },
  }) as unknown as Connection;

const createEmbeddedConnection = (authMode: ArdEmbeddedAuthMode): Connection =>
  ({
    ...connection,
    username: "remote-mac-user",
    ardSettings: {
      version: 3,
      authMode,
      crossPlatformFallback: { enabled: false, authMode: "macOsAccount" },
      autoReconnect: true,
      curtainOnConnect: false,
      localCursor: true,
      viewOnly: false,
    },
  }) as unknown as Connection;

const unavailableNativeCapabilities = (
  platform: "Windows" | "Linux" = "Windows",
): ArdRuntimeCapabilities => ({
  ...capabilities,
  appleAccountNative: {
    ...capabilities.appleAccountNative,
    available: false,
    reason: `Apple Screen Sharing requires macOS and is unavailable on ${platform}.`,
  },
});

const useConnection = (selected: Connection) => {
  mocks.useConnections.mockReturnValue({
    state: { connections: [selected], sessions: [] },
    dispatch: mocks.dispatch,
  });
};

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.invoke.mockReset();
  mocks.useConnections.mockReset();
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "get_ard_runtime_capabilities") {
      return Promise.resolve(capabilities);
    }
    if (command === "launch_apple_account_screen_sharing") {
      return Promise.resolve(handoff);
    }
    return Promise.resolve(undefined);
  });
});

describe("useArdClient native Apple Account handoff", () => {
  it("auto-launches once, invokes every explicit focus, and never claims connected", async () => {
    const { result, rerender } = renderHook(
      ({ hostname }) => useArdClient({ ...session, hostname }),
      { initialProps: { hostname: session.hostname } },
    );

    await waitFor(() => expect(result.current.status).toBe("nativeHandoff"));
    const launchCalls = () =>
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "launch_apple_account_screen_sharing",
      );
    expect(launchCalls()).toEqual([["launch_apple_account_screen_sharing"]]);

    rerender({ hostname: "renamed-family-mac.local" });
    await act(async () => Promise.resolve());
    expect(launchCalls()).toHaveLength(1);

    await act(async () => {
      await result.current.launchNativeScreenSharing();
      await result.current.launchNativeScreenSharing();
    });
    expect(launchCalls()).toEqual([
      ["launch_apple_account_screen_sharing"],
      ["launch_apple_account_screen_sharing"],
      ["launch_apple_account_screen_sharing"],
    ]);

    const invocations = JSON.stringify(mocks.invoke.mock.calls);
    const dispatches = JSON.stringify(mocks.dispatch.mock.calls);
    expect(invocations).not.toContain(appleAccountIdentifier);
    expect(invocations).not.toContain(savedPassword);
    expect(dispatches).not.toContain('"status":"connected"');
    expect(result.current.nativeHandoffResult).toEqual(handoff);
  });

  it("keeps an auto-launch failure retryable without exposing a saved password", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve(capabilities);
      }
      if (command === "launch_apple_account_screen_sharing") {
        return Promise.reject(new Error(`launcher failed: ${savedPassword}`));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("[redacted password]");
    expect(result.current.error).not.toContain(savedPassword);
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      '"status":"error"',
    );

    mocks.invoke.mockImplementation((command: string) => {
      if (command === "launch_apple_account_screen_sharing") {
        return Promise.resolve(handoff);
      }
      return Promise.resolve(capabilities);
    });
    await act(async () => {
      await result.current.launchNativeScreenSharing();
    });
    expect(result.current.status).toBe("nativeHandoff");
  });

  it("redacts a manual launch rejection before returning it to the component", async () => {
    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("nativeHandoff"));

    mocks.invoke.mockImplementation((command: string) => {
      if (command === "launch_apple_account_screen_sharing") {
        return Promise.reject(new Error(`manual failure: ${savedPassword}`));
      }
      return Promise.resolve(capabilities);
    });

    let rejection: unknown;
    try {
      await result.current.launchNativeScreenSharing();
    } catch (cause) {
      rejection = cause;
    }
    expect(rejection).toBeInstanceOf(Error);
    const message = (rejection as Error).message;
    expect(message).toContain("manual failure: [redacted password]");
    expect(message).not.toContain(savedPassword);
  });

  it("fails closed before runtime capabilities have loaded", async () => {
    let resolveCapabilities!: (value: ArdRuntimeCapabilities) => void;
    const pendingCapabilities = new Promise<ArdRuntimeCapabilities>(
      (resolve) => {
        resolveCapabilities = resolve;
      },
    );
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return pendingCapabilities;
      }
      if (command === "launch_apple_account_screen_sharing") {
        return Promise.reject(new Error("native launcher must not run"));
      }
      return Promise.resolve(undefined);
    });

    const { result, unmount } = renderHook(() => useArdClient(session));
    expect(result.current.runtimePath).toBe("resolving");
    await expect(result.current.launchNativeScreenSharing()).rejects.toThrow(
      "availability is still being checked",
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "launch_apple_account_screen_sharing",
      ),
    ).toHaveLength(0);

    unmount();
    await act(async () => {
      resolveCapabilities(capabilities);
      await pendingCapabilities;
    });
  });

  it("does not invoke the native launcher when runtime capabilities reject it", async () => {
    const unavailableReason =
      "Apple Account Screen Sharing requires Apple's macOS Screen Sharing app.";
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve({
          ...capabilities,
          appleAccountNative: {
            ...capabilities.appleAccountNative,
            available: false,
            reason: unavailableReason,
          },
        });
      }
      if (command === "launch_apple_account_screen_sharing") {
        return Promise.reject(new Error("native launcher must not run"));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(unavailableReason);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "launch_apple_account_screen_sharing",
      ),
    ).toHaveLength(0);
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      '"status":"error"',
    );

    await expect(result.current.launchNativeScreenSharing()).rejects.toThrow(
      unavailableReason,
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "launch_apple_account_screen_sharing",
      ),
    ).toHaveLength(0);
  });

  it("marks a failed capability check unavailable instead of leaving it resolving", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.reject(new Error("capability discovery failed"));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    expect(result.current.runtimePath).toBe("resolving");
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.runtimePath).toBe("unavailable");
    expect(result.current.error).toBe("capability discovery failed");
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "launch_apple_account_screen_sharing",
      ),
    ).toBe(false);
  });

  it("ignores a pending native handoff after unmount", async () => {
    let resolveLaunch!: (value: ArdNativeHandoffResult) => void;
    const pendingLaunch = new Promise<ArdNativeHandoffResult>((resolve) => {
      resolveLaunch = resolve;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve(capabilities);
      }
      if (command === "launch_apple_account_screen_sharing") {
        return pendingLaunch;
      }
      return Promise.resolve(undefined);
    });

    const { unmount } = renderHook(() => useArdClient(session));
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.filter(
          ([command]) => command === "launch_apple_account_screen_sharing",
        ),
      ).toHaveLength(1),
    );
    const dispatchCountAtUnmount = mocks.dispatch.mock.calls.length;
    unmount();

    await act(async () => {
      resolveLaunch(handoff);
      await pendingLaunch;
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(dispatchCountAtUnmount);
  });
});

describe("useArdClient cross-platform Apple Account fallback", () => {
  it.each([
    ["Windows" as const, "macOsAccount" as const, "remote-mac-user"],
    ["Windows" as const, "vncPassword" as const, ""],
    ["Linux" as const, "macOsAccount" as const, "remote-mac-user"],
    ["Linux" as const, "vncPassword" as const, ""],
  ])(
    "selects the explicit %s %s fallback and reports connected only from the backend",
    async (platform, authMode, expectedUsername) => {
      const selected = createFallbackConnection(authMode);
      useConnection(selected);
      mocks.invoke.mockImplementation((command: string) => {
        if (command === "get_ard_runtime_capabilities") {
          return Promise.resolve(unavailableNativeCapabilities(platform));
        }
        if (command === "connect_ard") {
          return Promise.resolve("fallback-backend-session");
        }
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useArdClient(session));
      await waitFor(() =>
        expect(result.current.backendSessionId).toBe(
          "fallback-backend-session",
        ),
      );

      expect(result.current.runtimePath).toBe("embeddedFallback");
      expect(result.current.status).toBe("connecting");
      expect(result.current.message).toContain(
        "explicitly configured embedded fallback",
      );
      expect(result.current.message).toContain(
        "never Apple Account credentials",
      );

      const connectCall = mocks.invoke.mock.calls.find(
        ([command]) => command === "connect_ard",
      );
      expect(connectCall).toBeDefined();
      const args = connectCall?.[1] as Record<string, unknown>;
      expect(Object.keys(args).sort()).toEqual(
        [
          "authenticationMode",
          "autoReconnect",
          "connectionId",
          "curtainOnConnect",
          "frameDataChannel",
          "frameMetadataChannel",
          "host",
          "localCursor",
          "password",
          "port",
          "statusChannel",
          "username",
        ].sort(),
      );
      expect(args).toEqual(
        expect.objectContaining({
          host: session.hostname,
          port: 5900,
          username: expectedUsername,
          password: savedPassword,
          connectionId: selected.id,
          authenticationMode: authMode,
        }),
      );
      expect(JSON.stringify(args)).not.toContain(appleAccountIdentifier);
      expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
        '"status":"connected"',
      );

      const statusChannel = args.statusChannel as {
        onmessage(event: ArdStatusEvent): void;
      };
      act(() => {
        statusChannel.onmessage({
          sessionId: "fallback-backend-session",
          status: "connected",
          message: "Connected by embedded ARD",
          timestamp: "2026-01-01T00:00:01Z",
        });
      });
      expect(result.current.status).toBe("connected");
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPDATE_SESSION",
          payload: expect.objectContaining({ status: "connected" }),
        }),
      );
    },
  );

  it("keeps a non-macOS native profile fail-closed without explicit opt-in", async () => {
    useConnection(createFallbackConnection("macOsAccount", false));
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve(unavailableNativeCapabilities("Windows"));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.runtimePath).toBe("unavailable");
    expect(result.current.error).toContain("unavailable on Windows");
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "connect_ard"),
    ).toBe(false);
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "launch_apple_account_screen_sharing",
      ),
    ).toBe(false);
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      '"status":"error"',
    );
  });

  it("gives native macOS handoff precedence over an enabled fallback", async () => {
    useConnection(createFallbackConnection());
    const { result } = renderHook(() => useArdClient(session));

    await waitFor(() => expect(result.current.status).toBe("nativeHandoff"));
    expect(result.current.runtimePath).toBe("nativeAppleAccount");
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "launch_apple_account_screen_sharing",
      ),
    ).toEqual([["launch_apple_account_screen_sharing"]]);
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "connect_ard"),
    ).toBe(false);
    const invocations = JSON.stringify(mocks.invoke.mock.calls);
    expect(invocations).not.toContain(appleAccountIdentifier);
    expect(invocations).not.toContain(savedPassword);
  });

  it("uses the enabled fallback when macOS cannot open Screen Sharing", async () => {
    useConnection(createFallbackConnection("macOsAccount"));
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve(capabilities);
      }
      if (command === "launch_apple_account_screen_sharing") {
        return Promise.reject(new Error("open command failed"));
      }
      if (command === "connect_ard") {
        return Promise.resolve("launcher-fallback-session");
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("launcher-fallback-session"),
    );

    expect(result.current.runtimePath).toBe("embeddedFallback");
    expect(result.current.message).toContain(
      "Apple Screen Sharing could not be opened",
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "launch_apple_account_screen_sharing",
      ),
    ).toEqual([["launch_apple_account_screen_sharing"]]);
    await expect(result.current.launchNativeScreenSharing()).rejects.toThrow(
      "embedded ARD fallback is in use",
    );
  });

  it("fails truthfully when the embedded runtime is unavailable", async () => {
    useConnection(createFallbackConnection());
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve({
          ...unavailableNativeCapabilities("Linux"),
          embeddedRfb: { ...capabilities.embeddedRfb, available: false },
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.runtimePath).toBe("embeddedFallback");
    expect(result.current.error).toContain(
      "embedded ARD/RFB runtime is unavailable",
    );
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "connect_ard"),
    ).toBe(false);
    expect(JSON.stringify(mocks.dispatch.mock.calls)).toContain(
      '"status":"error"',
    );
  });

  it("rejects an unsupported fallback authentication mode", async () => {
    useConnection(createFallbackConnection("macOsAccount"));
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve({
          ...unavailableNativeCapabilities("Windows"),
          embeddedRfb: {
            ...capabilities.embeddedRfb,
            authenticationModes: ["vncPassword"],
          },
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain(
      "does not support the configured macOsAccount authentication fallback",
    );
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "connect_ard"),
    ).toBe(false);
  });

  it("rejects saved application routes before starting the fallback", async () => {
    useConnection({
      ...createFallbackConnection(),
      proxyChainId: "must-not-be-bypassed",
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve(unavailableNativeCapabilities("Linux"));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("direct TCP connections only");
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "connect_ard"),
    ).toBe(false);
  });

  it("reports an embedded fallback connection failure on the frontend session", async () => {
    useConnection(createFallbackConnection());
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve(unavailableNativeCapabilities("Windows"));
      }
      if (command === "connect_ard") {
        return Promise.reject(new Error(`backend rejected ${savedPassword}`));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("backend rejected [redacted password]");
    expect(result.current.runtimePath).toBe("embeddedFallback");
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          status: "error",
          errorMessage: "backend rejected [redacted password]",
        }),
      }),
    );
  });
});

describe("useArdClient direct embedded capability errors", () => {
  it("describes an unavailable runtime as an embedded session failure", async () => {
    useConnection(createEmbeddedConnection("macOsAccount"));
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve({
          ...capabilities,
          embeddedRfb: { ...capabilities.embeddedRfb, available: false },
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.runtimePath).toBe("embedded");
    expect(result.current.error).toContain("embedded ARD session cannot start");
    expect(result.current.error).not.toContain("cross-platform fallback");
    expect(JSON.stringify(mocks.dispatch.mock.calls)).toContain(
      '"status":"error"',
    );
  });

  it("describes unsupported direct authentication as a mode, not a fallback", async () => {
    useConnection(createEmbeddedConnection("macOsAccount"));
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_ard_runtime_capabilities") {
        return Promise.resolve({
          ...capabilities,
          embeddedRfb: {
            ...capabilities.embeddedRfb,
            authenticationModes: ["vncPassword"],
          },
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useArdClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.runtimePath).toBe("embedded");
    expect(result.current.error).toContain(
      "configured macOsAccount authentication mode",
    );
    expect(result.current.error).not.toContain("authentication fallback");
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "connect_ard"),
    ).toBe(false);
  });
});

describe("ardDisplayError", () => {
  it("redacts the exact saved embedded password before rendering", () => {
    expect(
      ardDisplayError(`Authentication failed: ${savedPassword}`, savedPassword),
    ).toBe("Authentication failed: [redacted password]");
  });
});
