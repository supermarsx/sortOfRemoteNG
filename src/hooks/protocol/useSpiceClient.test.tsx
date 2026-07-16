import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  buildSpiceNativeConnectRequest,
  getUnsupportedSpiceRouteReason,
  spiceErrorMessage,
  useSpiceClient,
} from "./useSpiceClient";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));
vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

const ticket = "spice-ticket-secret";
const connection: Connection = {
  id: "spice-connection-1",
  name: "Virtual machine console",
  protocol: "spice" as Connection["protocol"],
  hostname: "vm.example.test",
  port: 5900,
  password: ticket,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  spiceTlsPort: 5901,
  spiceRequireTls: true,
  spiceCaCertificatePath: "C:\\certs\\spice-ca.pem",
  spiceTlsHostSubject: "CN=vm.example.test",
  spiceViewOnly: true,
  spiceFullscreen: true,
} as Connection;

const session: ConnectionSession = {
  id: "frontend-spice-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "spice",
  hostname: connection.hostname,
};

const sessionInfo = {
  id: "backend-spice-1",
  host: connection.hostname,
  port: 5900,
  tls_port: 5901,
  connected: true,
  label: connection.name,
  tls_active: false,
  view_only: true,
  connected_at: "2026-01-01T00:00:00Z",
  last_activity: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.useConnections.mockReset();
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "connect_spice") return Promise.resolve("backend-spice-1");
    if (command === "get_spice_session_info")
      return Promise.resolve(sessionInfo);
    if (command === "is_spice_connected") return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

describe("useSpiceClient", () => {
  it("builds only the documented native handoff controls", () => {
    expect(buildSpiceNativeConnectRequest(connection, session)).toEqual({
      host: "vm.example.test",
      port: 5900,
      tlsPort: 5901,
      password: ticket,
      label: connection.name,
      nativeClientPath: null,
      fullscreen: true,
      viewOnly: true,
      shareClipboard: true,
      usbRedirection: false,
      audioPlayback: true,
      preferredWidth: null,
      preferredHeight: null,
      proxy: null,
      requireTls: true,
      caCert: "C:\\certs\\spice-ca.pem",
      verifyHostname: "CN=vm.example.test",
      allowSelfSigned: false,
    });
  });

  it("repairs imported TLS requirements and rejects legacy unverified trust at runtime", () => {
    expect(
      buildSpiceNativeConnectRequest(
        {
          ...connection,
          spiceTlsPort: undefined,
          spiceAllowSelfSigned: true,
          spiceShareClipboard: false,
        },
        session,
      ),
    ).toMatchObject({
      tlsPort: 5901,
      requireTls: true,
      allowSelfSigned: false,
      shareClipboard: true,
    });
  });

  it("publishes only the backend process handle and never the ticket", async () => {
    const { result, unmount } = renderHook(() => useSpiceClient(session));
    await waitFor(() => expect(result.current.status).toBe("viewer-running"));

    expect(mocks.invoke).toHaveBeenCalledWith(
      "connect_spice",
      expect.objectContaining({ password: ticket, host: connection.hostname }),
    );
    const dispatched = JSON.stringify(mocks.dispatch.mock.calls);
    expect(dispatched).toContain("backend-spice-1");
    expect(dispatched).not.toContain(ticket);

    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).not.toHaveBeenCalledWith("disconnect_spice", {
      sessionId: "backend-spice-1",
    });
  });

  it("fails closed for generic route chains", () => {
    expect(
      getUnsupportedSpiceRouteReason({
        ...connection,
        proxyChainId: "proxy-chain-1",
      }),
    ).toMatch(/cannot consume the configured connection chain/i);
  });

  it("redacts a ticket echoed by a backend error", () => {
    const message = spiceErrorMessage(
      new Error(`viewer rejected ${ticket}`),
      connection,
    );
    expect(message).toContain("[redacted]");
    expect(message).not.toContain(ticket);
  });

  it("closes a newly launched viewer when session verification fails", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_spice") return Promise.resolve("orphan-spice");
      if (command === "get_spice_session_info") {
        return Promise.reject(new Error(`verification echoed ${ticket}`));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSpiceClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_spice", {
      sessionId: "orphan-spice",
    });
    expect(result.current.error).not.toContain(ticket);
  });

  it("closes a newly launched viewer when verified process state rejects it", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_spice") return Promise.resolve("stopped-spice");
      if (command === "get_spice_session_info") {
        return Promise.resolve({
          ...sessionInfo,
          id: "stopped-spice",
          connected: false,
        });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSpiceClient(session));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_spice", {
      sessionId: "stopped-spice",
    });
  });

  it("closes a launch that becomes stale before session verification starts", async () => {
    const connect = deferred<string>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_spice") return connect.promise;
      if (command === "get_spice_session_info") {
        return Promise.resolve(sessionInfo);
      }
      return Promise.resolve(undefined);
    });

    const { unmount } = renderHook(() => useSpiceClient(session));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "connect_spice",
        expect.any(Object),
      ),
    );
    unmount();
    await act(async () => {
      connect.resolve("stale-before-verification");
      await connect.promise;
    });

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("disconnect_spice", {
        sessionId: "stale-before-verification",
      }),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "get_spice_session_info",
      expect.anything(),
    );
  });

  it("closes a launch that becomes stale after successful session verification", async () => {
    const verification = deferred<typeof sessionInfo>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "connect_spice") return Promise.resolve("stale-spice");
      if (command === "get_spice_session_info") return verification.promise;
      return Promise.resolve(undefined);
    });

    const { unmount } = renderHook(() => useSpiceClient(session));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("get_spice_session_info", {
        sessionId: "stale-spice",
      }),
    );
    unmount();
    await act(async () => {
      verification.resolve({ ...sessionInfo, id: "stale-spice" });
      await verification.promise;
    });

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("disconnect_spice", {
        sessionId: "stale-spice",
      }),
    );
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ backendSessionId: "stale-spice" }),
      }),
    );
  });

  it("never lets a stale initializer close an existing viewer reused by its replacement", async () => {
    const existingId = "existing-spice";
    const firstVerification = deferred<typeof sessionInfo>();
    let verificationCount = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "is_spice_connected") return Promise.resolve(true);
      if (command === "get_spice_session_info") {
        verificationCount += 1;
        return verificationCount === 1
          ? firstVerification.promise
          : Promise.resolve({ ...sessionInfo, id: existingId });
      }
      return Promise.resolve(undefined);
    });

    const attachedSession = { ...session, backendSessionId: existingId };
    const { result } = renderHook(() => useSpiceClient(attachedSession));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("get_spice_session_info", {
        sessionId: existingId,
      }),
    );

    await act(async () => {
      await result.current.reconnect();
    });
    await waitFor(() => expect(result.current.status).toBe("viewer-running"));

    await act(async () => {
      firstVerification.resolve({ ...sessionInfo, id: existingId });
      await firstVerification.promise;
    });

    expect(mocks.invoke).not.toHaveBeenCalledWith("disconnect_spice", {
      sessionId: existingId,
    });
    expect(result.current.backendSessionId).toBe(existingId);
  });
});
