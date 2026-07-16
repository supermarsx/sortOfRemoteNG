import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import type { FtpEntry, FtpSessionInfo } from "../../src/types/ftp";

const mocks = vi.hoisted(() => ({
  manager: {} as Record<string, unknown>,
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mocks.open(...args),
  save: (...args: unknown[]) => mocks.save(...args),
}));

vi.mock("../../src/hooks/protocol/useFTPSession", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/hooks/protocol/useFTPSession")
    >();
  return {
    ...actual,
    useFTPSession: () => mocks.manager,
  };
});

import { FTPClient } from "../../src/components/protocol/FTPClient";

const session: ConnectionSession = {
  id: "frontend-ftp-1",
  connectionId: "connection-ftp-1",
  name: "Release mirror",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ftp",
  hostname: "ftp.example.test",
};

const fileEntry: FtpEntry = {
  name: "release.zip",
  kind: "file",
  size: 2048,
  modified: "2026-01-02T00:00:00Z",
  permissions: "rw-r--r--",
  owner: "release",
  group: "deploy",
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

const sessionInfo: FtpSessionInfo = {
  id: "backend-ftp-1",
  host: "ftp.example.test",
  port: 21,
  username: "release",
  security: "none",
  connected: true,
  currentDirectory: "/incoming",
  serverBanner: "220 ready",
  systemType: "UNIX",
  features: ["MLSD"],
  connectedAt: "2026-01-01T00:00:00Z",
  lastActivity: "2026-01-01T00:00:00Z",
  transferType: "binary",
  label: "Release mirror",
  bytesUploaded: 0,
  bytesDownloaded: 0,
};

const createManager = (patch: Record<string, unknown> = {}) => ({
  status: "connected",
  error: null,
  backendSessionId: "backend-ftp-1",
  sessionInfo,
  currentPath: "/incoming",
  entries: [fileEntry, directoryEntry],
  selectedName: fileEntry.name,
  selectedEntry: fileEntry,
  isBusy: false,
  lastTransfer: null,
  setSelectedName: vi.fn(),
  loadDirectory: vi.fn().mockResolvedValue([]),
  refreshDirectory: vi.fn().mockResolvedValue([]),
  navigateUp: vi.fn().mockResolvedValue(undefined),
  navigateInto: vi.fn().mockResolvedValue(undefined),
  createDirectory: vi.fn().mockResolvedValue("/incoming/new-folder"),
  renameEntry: vi.fn().mockResolvedValue(undefined),
  deleteEntry: vi.fn().mockResolvedValue(undefined),
  chmodEntry: vi.fn().mockResolvedValue(undefined),
  uploadFile: vi.fn().mockResolvedValue({
    direction: "upload",
    localPath: "C:\\builds\\release.zip",
    remotePath: "/incoming/release.zip",
    bytesTransferred: 2048,
  }),
  downloadFile: vi.fn().mockResolvedValue({
    direction: "download",
    localPath: "C:\\downloads\\release.zip",
    remotePath: "/incoming/release.zip",
    bytesTransferred: 2048,
  }),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ...patch,
});

beforeEach(() => {
  mocks.manager = createManager();
  mocks.open.mockReset();
  mocks.save.mockReset();
  vi.stubGlobal("prompt", vi.fn());
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FTPClient", () => {
  it("renders the live backend listing and navigates directories", async () => {
    render(<FTPClient session={session} />);

    expect(screen.getByText("FTP — ftp.example.test")).toBeInTheDocument();
    expect(screen.getByText("220 ready")).toBeInTheDocument();
    expect(screen.getByText("release.zip")).toBeInTheDocument();
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ftp-entry-archive"));
    expect(mocks.manager.setSelectedName).toHaveBeenCalledWith("archive");
    fireEvent.doubleClick(screen.getByTestId("ftp-entry-archive"));
    await waitFor(() =>
      expect(mocks.manager.navigateInto).toHaveBeenCalledWith(directoryEntry),
    );
  });

  it("uses native file paths for real upload and download commands", async () => {
    mocks.open.mockResolvedValue([
      "C:\\builds\\release.zip",
      "C:\\builds\\notes.txt",
    ]);
    mocks.save.mockResolvedValue("C:\\downloads\\release.zip");
    render(<FTPClient session={session} />);

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() =>
      expect(mocks.manager.uploadFile).toHaveBeenCalledTimes(2),
    );
    expect(mocks.manager.uploadFile).toHaveBeenNthCalledWith(
      1,
      "C:\\builds\\release.zip",
      "/incoming/release.zip",
    );
    expect(mocks.manager.uploadFile).toHaveBeenNthCalledWith(
      2,
      "C:\\builds\\notes.txt",
      "/incoming/notes.txt",
    );

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(mocks.manager.downloadFile).toHaveBeenCalledWith(
        "/incoming/release.zip",
        "C:\\downloads\\release.zip",
      ),
    );
  });

  it("wires mkdir, rename, chmod, delete, and disconnect to hook operations", async () => {
    const promptMock = vi.mocked(window.prompt);
    promptMock
      .mockReturnValueOnce("new-folder")
      .mockReturnValueOnce("renamed.zip")
      .mockReturnValueOnce("640");
    render(<FTPClient session={session} />);

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect FTP" }));

    await waitFor(() => {
      expect(mocks.manager.createDirectory).toHaveBeenCalledWith("new-folder");
      expect(mocks.manager.renameEntry).toHaveBeenCalledWith(
        fileEntry,
        "renamed.zip",
      );
      expect(mocks.manager.chmodEntry).toHaveBeenCalledWith(fileEntry, "640");
      expect(mocks.manager.deleteEntry).toHaveBeenCalledWith(fileEntry);
      expect(mocks.manager.disconnect).toHaveBeenCalledTimes(1);
    });
    expect(window.confirm).toHaveBeenCalledWith("Delete release.zip?");
  });

  it("never labels a failed transfer as completed", () => {
    mocks.manager = createManager({
      error: "FTP upload failed",
      lastTransfer: null,
    });
    render(<FTPClient session={session} />);

    expect(screen.getByRole("alert")).toHaveTextContent("FTP upload failed");
    expect(screen.queryByText(/completed/)).not.toBeInTheDocument();
  });
});
