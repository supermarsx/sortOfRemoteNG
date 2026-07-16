import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  ArdNativeHandoffResult,
  ArdRuntimeCapabilities,
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

describe("ardDisplayError", () => {
  it("redacts the exact saved embedded password before rendering", () => {
    expect(
      ardDisplayError(`Authentication failed: ${savedPassword}`, savedPassword),
    ).toBe("Authentication failed: [redacted password]");
  });
});
