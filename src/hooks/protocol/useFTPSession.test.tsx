import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  FTP_RUNTIME_CAPABILITIES,
  type FtpEntry,
  type FtpSessionInfo,
} from "../../types/ftp";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
} from "../../utils/session/runtimeConnectionRegistry";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  connections: [] as Connection[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: mocks.connections, sessions: [] },
    dispatch: mocks.dispatch,
  }),
}));

import {
  buildFtpConnectionConfig,
  getUnsupportedFtpRouteReason,
  joinFtpPath,
  parentFtpPath,
  useFTPSession,
} from "./useFTPSession";

const connection: Connection = {
  id: "connection-ftp-1",
  name: "Release mirror",
  protocol: "ftp",
  hostname: "ftp.example.test",
  port: 2121,
  username: "release",
  password: "ftp-secret-value",
  remotePath: "/incoming",
  timeout: 12,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const createSession = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-ftp-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "ftp",
  hostname: connection.hostname,
  ...patch,
});

const sessionInfo: FtpSessionInfo = {
  id: "backend-ftp-1",
  host: connection.hostname,
  port: connection.port,
  username: connection.username!,
  security: "none",
  connected: true,
  currentDirectory: "/incoming",
  serverBanner: "220 test server",
  systemType: "UNIX",
  features: ["MLSD", "UTF8"],
  connectedAt: "2026-01-01T00:00:00Z",
  lastActivity: "2026-01-01T00:00:00Z",
  transferType: "binary",
  label: connection.name,
  bytesUploaded: 0,
  bytesDownloaded: 0,
};

const fileEntry: FtpEntry = {
  name: "release.zip",
  kind: "file",
  size: 2048,
  modified: "2026-01-02T00:00:00Z",
  permissions: "rw-r--r--",
  owner: "release",
  group: "release",
  linkTarget: null,
  raw: null,
  facts: {},
};

const directoryEntry: FtpEntry = {
  ...fileEntry,
  name: "archive",
  kind: "directory",
  size: 0,
};

const defaultInvoke = (command: string) => {
  switch (command) {
    case "ftp_connect":
      return Promise.resolve(sessionInfo);
    case "ftp_get_session_info":
      return Promise.resolve(sessionInfo);
    case "ftp_list_directory":
      return Promise.resolve([fileEntry, directoryEntry]);
    case "ftp_upload_file":
      return Promise.resolve(2048);
    case "ftp_download_file":
      return Promise.resolve(2048);
    case "ftp_mkdir":
      return Promise.resolve("/incoming/new-folder");
    default:
      return Promise.resolve(undefined);
  }
};

beforeEach(() => {
  clearRuntimeConnectionsForTests();
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.connections = [connection];
  mocks.invoke.mockImplementation(defaultInvoke);
});

describe("FTP DTO and path contracts", () => {
  it("does not advertise inert queue, progress, keepalive, or ASCII transfer features", () => {
    expect(FTP_RUNTIME_CAPABILITIES).toMatchObject({
      uploadFile: true,
      downloadFile: true,
      queueExecution: false,
      directTransferProgress: false,
      automaticKeepalive: false,
      asciiDirectTransfer: false,
      activeDataChannel: false,
      resumeUpload: false,
      resumeDownload: false,
      routedConnections: false,
    });
  });

  it("builds the exact camelCase backend config without copying it onto the session", () => {
    expect(buildFtpConnectionConfig(connection, createSession())).toEqual({
      host: "ftp.example.test",
      port: 2121,
      username: "release",
      password: "ftp-secret-value",
      security: "none",
      transferType: "binary",
      dataChannelMode: "passive",
      initialDirectory: "/incoming",
      connectTimeoutSec: 12,
      dataTimeoutSec: 30,
      keepaliveIntervalSec: 0,
      acceptInvalidCerts: false,
      utf8: true,
      activeBindAddress: null,
      label: "Release mirror",
    });
  });

  it("normalizes child and parent paths", () => {
    expect(joinFtpPath("/incoming/", "archive")).toBe("/incoming/archive");
    expect(parentFtpPath("/incoming/archive")).toBe("/incoming");
    expect(parentFtpPath("/")).toBe("/");
  });

  it.each(["active", "extendedActive"])(
    "rejects broken %s data-channel mode instead of timing out",
    (ftpDataChannelMode) => {
      expect(() =>
        buildFtpConnectionConfig(
          { ...connection, ftpDataChannelMode } as Connection,
          createSession(),
        ),
      ).toThrow(/active FTP data channels are unavailable/i);
    },
  );

  it.each([
    { proxyChainId: "proxy-chain-1" },
    { connectionChainId: "connection-chain-1" },
    { tunnelChainId: "tunnel-chain-1" },
    { security: { proxy: { enabled: true } } },
    { security: { openvpn: { enabled: true } } },
    { security: { sshTunnel: { enabled: true } } },
    { security: { tunnelChain: [{ id: "route-1", enabled: true }] } },
  ])("rejects a configured route the FTP backend cannot apply", (route) => {
    expect(
      getUnsupportedFtpRouteReason({
        ...connection,
        ...route,
      } as Connection),
    ).toContain("direct connections only");
  });
});

describe("useFTPSession", () => {
  it("connects from the saved connection, lists the initial directory, and persists only the backend id", async () => {
    const { result, unmount } = renderHook(() =>
      useFTPSession(createSession()),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    expect(mocks.invoke).toHaveBeenCalledWith("ftp_connect", {
      config: expect.objectContaining({
        host: "ftp.example.test",
        port: 2121,
        username: "release",
        password: "ftp-secret-value",
        initialDirectory: "/incoming",
      }),
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ftp_list_directory", {
      sessionId: "backend-ftp-1",
      path: "/incoming",
      options: null,
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "frontend-ftp-1",
        backendSessionId: "backend-ftp-1",
        status: "connected",
      }),
    });
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      "ftp-secret-value",
    );

    unmount();
    expect(mocks.invoke).not.toHaveBeenCalledWith("ftp_disconnect", {
      sessionId: "backend-ftp-1",
    });
  });

  it("resolves volatile Quick Connect credentials without serializing them", async () => {
    mocks.connections = [];
    registerRuntimeConnection(connection);
    const { result, unmount } = renderHook(() =>
      useFTPSession(createSession()),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith("ftp_connect", {
      config: expect.objectContaining({ password: "ftp-secret-value" }),
    });
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      "ftp-secret-value",
    );
    unmount();
  });

  it("reattaches a live backend session instead of opening a duplicate", async () => {
    const { result, unmount } = renderHook(() =>
      useFTPSession(
        createSession({
          status: "connected",
          backendSessionId: "backend-ftp-1",
        }),
      ),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith("ftp_get_session_info", {
      sessionId: "backend-ftp-1",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "ftp_connect",
      expect.anything(),
    );
    unmount();
  });

  it("executes real file and directory commands with exact native paths", async () => {
    const { result, unmount } = renderHook(() =>
      useFTPSession(createSession()),
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => {
      await result.current.createDirectory("new-folder");
      await result.current.renameEntry(fileEntry, "renamed.zip");
      await result.current.chmodEntry(fileEntry, "640");
      await result.current.deleteEntry(fileEntry);
      await result.current.deleteEntry(directoryEntry);
      await result.current.uploadFile(
        "C:\\builds\\release.zip",
        "/incoming/release.zip",
      );
      await result.current.downloadFile(
        "/incoming/release.zip",
        "C:\\downloads\\release.zip",
      );
    });

    expect(mocks.invoke).toHaveBeenCalledWith("ftp_mkdir", {
      sessionId: "backend-ftp-1",
      path: "/incoming/new-folder",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ftp_rename", {
      sessionId: "backend-ftp-1",
      from: "/incoming/release.zip",
      to: "/incoming/renamed.zip",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ftp_chmod", {
      sessionId: "backend-ftp-1",
      path: "/incoming/release.zip",
      mode: "640",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ftp_delete_file", {
      sessionId: "backend-ftp-1",
      path: "/incoming/release.zip",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ftp_rmdir_recursive", {
      sessionId: "backend-ftp-1",
      path: "/incoming/archive",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ftp_upload_file", {
      sessionId: "backend-ftp-1",
      localPath: "C:\\builds\\release.zip",
      remotePath: "/incoming/release.zip",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ftp_download_file", {
      sessionId: "backend-ftp-1",
      remotePath: "/incoming/release.zip",
      localPath: "C:\\downloads\\release.zip",
    });
    expect(result.current.lastTransfer).toEqual({
      direction: "download",
      localPath: "C:\\downloads\\release.zip",
      remotePath: "/incoming/release.zip",
      bytesTransferred: 2048,
    });
    unmount();
  });

  it("coalesces concurrent disconnects and treats an already-absent backend as disconnected", async () => {
    let releaseDisconnect!: () => void;
    const disconnectResult = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "ftp_disconnect") return disconnectResult;
      return defaultInvoke(command);
    });
    const { result, unmount } = renderHook(() =>
      useFTPSession(createSession()),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.disconnect();
      second = result.current.disconnect();
    });
    expect(first).toBe(second);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "ftp_disconnect",
      ),
    ).toHaveLength(1);

    await act(async () => {
      releaseDisconnect();
      await first;
    });
    expect(result.current.status).toBe("disconnected");
    await act(async () => result.current.disconnect());
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "ftp_disconnect",
      ),
    ).toHaveLength(1);
    unmount();
  });

  it("retains the backend id and permits retry after a real disconnect failure", async () => {
    const { result } = renderHook(() =>
      useFTPSession(
        createSession({
          status: "connected",
          backendSessionId: "backend-ftp-1",
        }),
      ),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));

    let disconnectAttempts = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "ftp_disconnect") {
        disconnectAttempts += 1;
        return disconnectAttempts === 1
          ? Promise.reject(new Error("temporary control-channel failure"))
          : Promise.resolve(undefined);
      }
      return defaultInvoke(command);
    });

    await act(async () => {
      await expect(result.current.disconnect()).rejects.toThrow(
        "temporary control-channel failure",
      );
    });
    expect(result.current.backendSessionId).toBe("backend-ftp-1");
    expect(result.current.status).toBe("error");

    await act(async () => result.current.disconnect());
    expect(result.current.backendSessionId).toBeNull();
    expect(result.current.status).toBe("disconnected");
    expect(disconnectAttempts).toBe(2);
  });

  it("surfaces connect failures with credential text redacted", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "ftp_connect") {
        return Promise.reject(new Error("login rejected: ftp-secret-value"));
      }
      return defaultInvoke(command);
    });
    const { result } = renderHook(() => useFTPSession(createSession()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("login rejected: [redacted]");
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(
      "ftp-secret-value",
    );
  });

  it("rethrows file-operation failures only after credential redaction", async () => {
    const { result } = renderHook(() => useFTPSession(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "ftp_upload_file") {
        return Promise.reject(
          new Error("upload rejected for ftp-secret-value"),
        );
      }
      return defaultInvoke(command);
    });

    await act(async () => {
      await expect(
        result.current.uploadFile(
          "C:\\builds\\release.zip",
          "/incoming/release.zip",
        ),
      ).rejects.toThrow("upload rejected for [redacted]");
    });
    expect(result.current.error).toBe("upload rejected for [redacted]");
    expect(result.current.lastTransfer).toBeNull();
  });

  it("fails closed instead of bypassing a saved proxy or tunnel route", async () => {
    mocks.connections = [{ ...connection, proxyChainId: "proxy-chain-1" }];
    const { result } = renderHook(() => useFTPSession(createSession()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("direct connections only");
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "ftp_connect",
      expect.anything(),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        status: "error",
      }),
    });
  });
});
