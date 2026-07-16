import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  SCP_RUNTIME_CAPABILITIES,
  type ScpDirectoryTransferResult,
  type ScpSessionInfo,
  type ScpTransferResult,
} from "../../types/scp";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
} from "../../utils/session/runtimeConnectionRegistry";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
  useSettings: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

vi.mock("../../contexts/SettingsContext", () => ({
  useSettings: () => mocks.useSettings(),
}));

import {
  getUnsupportedScpRouteReason,
  resolveScpKnownHostsPolicy,
  useScpClient,
} from "./useScpClient";

const connection: Connection = {
  id: "connection-scp-1",
  name: "SCP host",
  protocol: "scp",
  hostname: "scp.example.test",
  port: 2222,
  username: "operator",
  password: "saved-password-987",
  privateKey: "saved-private-key-material-654",
  passphrase: "saved-passphrase-321",
  authType: "key",
  remotePath: "/srv/files",
  ignoreSshSecurityErrors: true,
  sshConnectTimeout: 18,
  sshKeepAliveInterval: 45,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const createSession = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-scp-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "scp",
  hostname: connection.hostname,
  ...patch,
});

const sessionInfo = (id = "backend-scp-1"): ScpSessionInfo => ({
  id,
  host: connection.hostname,
  port: connection.port,
  username: connection.username || "",
  authMethod: "publickey-memory",
  connected: true,
  label: connection.name,
  colorTag: null,
  serverBanner: "SSH-2.0-Test",
  remoteHome: "/home/operator",
  connectedAt: "2026-01-01T00:00:00Z",
  lastActivity: "2026-01-01T00:00:00Z",
  bytesUploaded: 0,
  bytesDownloaded: 0,
  transfersCount: 0,
  serverFingerprint: "SHA256:test",
});

const entries = [
  {
    name: "logs",
    path: "/srv/files/logs",
    size: 0,
    isDir: true,
    isFile: false,
    isSymlink: false,
    mode: "drwxr-xr-x",
    mtime: "2026-01-01 10:00",
    owner: "operator",
    group: "staff",
  },
  {
    name: "readme.txt",
    path: "/srv/files/readme.txt",
    size: 42,
    isDir: false,
    isFile: true,
    isSymlink: false,
    mode: "-rw-r--r--",
    mtime: "2026-01-01 10:00",
    owner: "operator",
    group: "staff",
  },
];

const fileResult = (direction: "upload" | "download"): ScpTransferResult => ({
  transferId: `transfer-${direction}`,
  direction,
  localPath: "C:\\tmp\\readme.txt",
  remotePath: "/srv/files/readme.txt",
  bytesTransferred: 42,
  durationMs: 10,
  averageSpeed: 4200,
  checksum: null,
  success: true,
  error: null,
});

const directoryResult = (
  direction: "upload" | "download",
): ScpDirectoryTransferResult => ({
  transferId: `directory-${direction}`,
  direction,
  localPath: "C:\\tmp\\logs",
  remotePath: "/srv/files/logs",
  filesTransferred: 2,
  filesFailed: 0,
  filesSkipped: 0,
  totalBytes: 84,
  durationMs: 20,
  averageSpeed: 4200,
  errors: [],
});

beforeEach(() => {
  clearRuntimeConnectionsForTests();
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.useConnections.mockReset();
  mocks.useSettings.mockReset();
  mocks.useSettings.mockReturnValue({
    settings: {
      sshTrustPolicy: "always-ask",
      trustPolicy: "always-ask",
    },
  });
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "scp_connect") return Promise.resolve(sessionInfo());
    if (command === "scp_get_session_info") {
      return Promise.resolve(sessionInfo());
    }
    if (command === "scp_remote_ls") return Promise.resolve(entries);
    if (command === "scp_upload") return Promise.resolve(fileResult("upload"));
    if (command === "scp_download") {
      return Promise.resolve(fileResult("download"));
    }
    if (command === "scp_upload_directory") {
      return Promise.resolve(directoryResult("upload"));
    }
    if (command === "scp_download_directory") {
      return Promise.resolve(directoryResult("download"));
    }
    if (command === "scp_remote_checksum") {
      return Promise.resolve("sha256-real-result");
    }
    return Promise.resolve(undefined);
  });
});

describe("useScpClient", () => {
  it("does not advertise blocked cancellation, progress, or keepalive", () => {
    expect(SCP_RUNTIME_CAPABILITIES).toMatchObject({
      cancelTransfer: false,
      liveTransferProgress: false,
      automaticKeepalive: false,
      verifiedHostKey: true,
      customKnownHostsPath: true,
      interactiveHostKeyPrompt: false,
    });
  });

  it.each([
    [{ ignoreSshSecurityErrors: true }, "always-ask", "always-ask", "ignore"],
    [{ sshTrustPolicy: "strict" }, "tofu", "always-trust", "strict"],
    [{ sshTrustPolicy: "tofu" }, "strict", "always-ask", "acceptNew"],
    [{ sshTrustPolicy: "always-ask" }, "tofu", "strict", "ask"],
    [{ sshTrustPolicy: "inherit" }, "tofu", "strict", "acceptNew"],
    [{ sshTrustPolicy: "inherit" }, "inherit", "strict", "strict"],
    [{ sshTrustPolicy: "inherit" }, "inherit", "always-trust", "ignore"],
    [
      {
        sshConnectionConfigOverride: {
          strictHostKeyChecking: "yes",
        },
      },
      "tofu",
      "always-trust",
      "strict",
    ],
    [
      {
        sshConnectionConfigOverride: {
          strictHostKeyChecking: "accept-new",
        },
      },
      "strict",
      "always-trust",
      "acceptNew",
    ],
    [
      {
        sshConnectionConfigOverride: {
          strictHostKeyChecking: "ask",
        },
      },
      "tofu",
      "always-trust",
      "ask",
    ],
    [
      {
        sshConnectionConfigOverride: {
          strictHostKeyChecking: "no",
        },
      },
      "strict",
      "strict",
      "ignore",
    ],
  ] as const)(
    "maps saved and inherited host-key policy %# without weakening it",
    (patch, globalPolicy, rootPolicy, expected) => {
      expect(
        resolveScpKnownHostsPolicy(
          {
            ...connection,
            ignoreSshSecurityErrors: false,
            sshTrustPolicy: undefined,
            ...patch,
          } as Connection,
          globalPolicy,
          rootPolicy,
        ),
      ).toBe(expected);
    },
  );

  it("connects through the native backend without persisting credentials on ConnectionSession", async () => {
    const { result, unmount } = renderHook(() => useScpClient(createSession()));

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith("scp_connect", {
      config: expect.objectContaining({
        host: connection.hostname,
        port: 2222,
        username: "operator",
        password: null,
        privateKeyData: "saved-private-key-material-654",
        privateKeyPassphrase: "saved-passphrase-321",
        useAgent: false,
        knownHostsPolicy: "ignore",
        knownHostsPath: null,
        timeoutSecs: 18,
        keepaliveIntervalSecs: 0,
        proxy: null,
      }),
    });
    expect(mocks.invoke).toHaveBeenCalledWith("scp_remote_ls", {
      sessionId: "backend-scp-1",
      path: "/srv/files",
    });
    expect(result.current.entries).toEqual(entries);

    const sessionUpdates = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === "UPDATE_SESSION");
    expect(sessionUpdates).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          backendSessionId: "backend-scp-1",
          status: "connected",
        }),
      }),
    );
    const serializedUpdates = JSON.stringify(sessionUpdates);
    expect(serializedUpdates).not.toContain("saved-password-987");
    expect(serializedUpdates).not.toContain("saved-passphrase-321");
    expect(serializedUpdates).not.toContain("saved-private-key-material-654");

    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).not.toHaveBeenCalledWith("scp_disconnect", {
      sessionId: "backend-scp-1",
    });
  });

  it("resolves volatile Quick Connect credentials without copying them to session state", async () => {
    mocks.useConnections.mockReturnValue({
      state: { connections: [], sessions: [] },
      dispatch: mocks.dispatch,
    });
    registerRuntimeConnection({
      ...connection,
      authType: "password",
      privateKey: undefined,
      passphrase: undefined,
    });

    const { result } = renderHook(() => useScpClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    expect(mocks.invoke).toHaveBeenCalledWith(
      "scp_connect",
      expect.objectContaining({
        config: expect.objectContaining({ password: "saved-password-987" }),
      }),
    );
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      "saved-password-987",
    );
  });

  it("reattaches a live backend and disconnects an id at most once", async () => {
    const { result } = renderHook(() =>
      useScpClient(
        createSession({
          status: "connected",
          backendSessionId: "backend-scp-1",
        }),
      ),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith("scp_get_session_info", {
      sessionId: "backend-scp-1",
    });
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "scp_connect"),
    ).toBe(false);

    await act(async () => {
      await Promise.all([
        result.current.disconnect(),
        result.current.disconnect(),
      ]);
      await result.current.disconnect();
    });
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "scp_disconnect",
      ),
    ).toEqual([["scp_disconnect", { sessionId: "backend-scp-1" }]]);
  });

  it("retains the backend handle and permits retry after a real disconnect failure", async () => {
    const { result } = renderHook(() =>
      useScpClient(
        createSession({
          status: "connected",
          backendSessionId: "backend-scp-1",
        }),
      ),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "scp_disconnect") {
        const attempts = mocks.invoke.mock.calls.filter(
          ([name]) => name === "scp_disconnect",
        ).length;
        return attempts === 1
          ? Promise.reject("temporary disconnect failure")
          : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    await act(async () => {
      await expect(result.current.disconnect()).rejects.toThrow(
        "temporary disconnect failure",
      );
    });
    expect(result.current.backendSessionId).toBe("backend-scp-1");
    expect(result.current.status).toBe("error");

    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.backendSessionId).toBeNull();
    expect(result.current.status).toBe("disconnected");
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "scp_disconnect",
      ),
    ).toHaveLength(2);
  });

  it("replaces the backend exactly once for a reconnect attempt", async () => {
    let connectCount = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "scp_connect") {
        connectCount += 1;
        return Promise.resolve(sessionInfo(`backend-scp-${connectCount}`));
      }
      if (command === "scp_remote_ls") return Promise.resolve(entries);
      return Promise.resolve(undefined);
    });
    const { result, rerender } = renderHook(
      ({ currentSession }) => useScpClient(currentSession),
      { initialProps: { currentSession: createSession() } },
    );
    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("backend-scp-1"),
    );

    rerender({
      currentSession: createSession({
        status: "reconnecting",
        reconnectAttempts: 1,
        backendSessionId: "backend-scp-1",
      }),
    });

    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("backend-scp-2"),
    );
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === "scp_connect"),
    ).toHaveLength(2);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "scp_disconnect",
      ),
    ).toEqual([["scp_disconnect", { sessionId: "backend-scp-1" }]]);
  });

  it("calls only registered native file operations and exposes no rename", async () => {
    const { result } = renderHook(() => useScpClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.invoke.mockClear();

    await act(async () => {
      await result.current.mkdir("/srv/files/new");
      await result.current.deleteEntry({
        path: "/srv/files/readme.txt",
        isDir: false,
      });
      await result.current.deleteEntry({
        path: "/srv/files/logs",
        isDir: true,
      });
      await result.current.uploadFile(
        "C:\\tmp\\readme.txt",
        "/srv/files/readme.txt",
      );
      await result.current.downloadFile(
        "/srv/files/readme.txt",
        "C:\\tmp\\readme.txt",
      );
      await result.current.uploadDirectory("C:\\tmp\\logs", "/srv/files/logs");
      await result.current.downloadDirectory(
        "/srv/files/logs",
        "C:\\tmp\\logs",
      );
      expect(await result.current.checksum("/srv/files/readme.txt")).toBe(
        "sha256-real-result",
      );
    });

    expect(mocks.invoke).toHaveBeenCalledWith("scp_remote_mkdir_p", {
      sessionId: "backend-scp-1",
      path: "/srv/files/new",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("scp_remote_rm", {
      sessionId: "backend-scp-1",
      path: "/srv/files/readme.txt",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("scp_remote_rm_rf", {
      sessionId: "backend-scp-1",
      path: "/srv/files/logs",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("scp_upload", {
      request: {
        sessionId: "backend-scp-1",
        localPath: "C:\\tmp\\readme.txt",
        remotePath: "/srv/files/readme.txt",
        createParents: true,
        overwrite: true,
      },
    });
    expect(mocks.invoke).toHaveBeenCalledWith("scp_download", {
      request: {
        sessionId: "backend-scp-1",
        localPath: "C:\\tmp\\readme.txt",
        remotePath: "/srv/files/readme.txt",
        overwrite: true,
      },
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "scp_upload_directory",
      expect.any(Object),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "scp_download_directory",
      expect.any(Object),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("scp_remote_checksum", {
      sessionId: "backend-scp-1",
      path: "/srv/files/readme.txt",
    });
    expect(result.current).not.toHaveProperty("rename");
  });

  it("redacts every saved credential from UI and UPDATE_SESSION errors", async () => {
    mocks.invoke.mockRejectedValueOnce(
      `failed saved-password-987 saved-passphrase-321 saved-private-key-material-654`,
    );
    const { result } = renderHook(() => useScpClient(createSession()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("[redacted]");
    const rendered = `${result.current.error} ${JSON.stringify(
      mocks.dispatch.mock.calls,
    )}`;
    expect(rendered).not.toContain("saved-password-987");
    expect(rendered).not.toContain("saved-passphrase-321");
    expect(rendered).not.toContain("saved-private-key-material-654");
  });

  it("passes strict host-key policy and custom known_hosts path to the native connection", async () => {
    mocks.useConnections.mockReturnValue({
      state: {
        connections: [
          {
            ...connection,
            ignoreSshSecurityErrors: false,
            sshTrustPolicy: "strict",
            sshKnownHostsPath: "C:\\Users\\operator\\.ssh\\known_hosts-scp",
          },
        ],
        sessions: [],
      },
      dispatch: mocks.dispatch,
    });

    const { result } = renderHook(() => useScpClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    expect(mocks.invoke).toHaveBeenCalledWith("scp_connect", {
      config: expect.objectContaining({
        knownHostsPolicy: "strict",
        knownHostsPath: "C:\\Users\\operator\\.ssh\\known_hosts-scp",
      }),
    });
  });

  it("fails closed for every persisted proxy, tunnel, and VPN route field", () => {
    const routedConnections: Connection[] = [
      { ...connection, proxyChainId: "proxy-chain" },
      { ...connection, connectionChainId: "connection-chain" },
      { ...connection, tunnelChainId: "tunnel-chain" },
      {
        ...connection,
        security: {
          proxy: {
            type: "socks5",
            host: "proxy.test",
            port: 1080,
            enabled: true,
          },
        },
      },
      {
        ...connection,
        security: { openvpn: { enabled: true, configId: "vpn" } },
      },
      {
        ...connection,
        security: {
          sshTunnel: {
            enabled: true,
            connectionId: "jump",
            localPort: 0,
            remoteHost: connection.hostname,
            remotePort: connection.port,
          },
        },
      },
      {
        ...connection,
        security: {
          tunnelChain: [
            {
              id: "inline-vpn",
              type: "wireguard",
              enabled: true,
            },
          ],
        },
      },
    ];

    for (const routed of routedConnections) {
      expect(getUnsupportedScpRouteReason(routed)).toMatch(
        /direct connections only/i,
      );
    }
    expect(
      getUnsupportedScpRouteReason({
        ...connection,
        security: {
          proxy: {
            type: "socks5",
            host: "proxy.test",
            port: 1080,
            enabled: false,
          },
          tunnelChain: [{ id: "disabled", type: "wireguard", enabled: false }],
        },
      }),
    ).toBeNull();
    expect(
      getUnsupportedScpRouteReason({
        ...connection,
        ignoreSshSecurityErrors: false,
        sshTrustPolicy: "strict",
      }),
    ).toBeNull();
  });
});
