import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../hooks/protocol/useScpClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useScpClient: (...args: unknown[]) => mocks.hook(...args),
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mocks.open(...args),
  save: (...args: unknown[]) => mocks.save(...args),
}));

import { ScpClient } from "./ScpClient";

const session: ConnectionSession = {
  id: "frontend-scp-1",
  connectionId: "connection-scp-1",
  name: "SCP host",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "scp",
  hostname: "scp.example.test",
  backendSessionId: "backend-scp-1",
};

const remoteEntries = [
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
    name: "report.txt",
    path: "/srv/files/report.txt",
    size: 1024,
    isDir: false,
    isFile: true,
    isSymlink: false,
    mode: "-rw-r--r--",
    mtime: "2026-01-01 11:00",
    owner: "operator",
    group: "staff",
  },
];

const createModel = () => ({
  status: "connected" as const,
  error: null,
  backendSessionId: "backend-scp-1",
  homePath: "/home/operator",
  currentPath: "/srv/files",
  entries: remoteEntries,
  isBusy: false,
  lastTransfer: null,
  loadDirectory: vi.fn().mockResolvedValue(remoteEntries),
  refreshDirectory: vi.fn().mockResolvedValue(remoteEntries),
  navigateUp: vi.fn().mockResolvedValue(remoteEntries),
  stat: vi.fn(),
  checksum: vi.fn().mockResolvedValue("real-sha256"),
  mkdir: vi.fn().mockResolvedValue(remoteEntries),
  deleteEntry: vi.fn().mockResolvedValue(remoteEntries),
  uploadFile: vi.fn().mockResolvedValue({
    transferId: "upload-file",
    direction: "upload",
    localPath: "C:\\tmp\\upload.txt",
    remotePath: "/srv/files/upload.txt",
    bytesTransferred: 128,
    durationMs: 1,
    averageSpeed: 128000,
    success: true,
  }),
  downloadFile: vi.fn().mockResolvedValue({
    transferId: "download-file",
    direction: "download",
    localPath: "C:\\Downloads\\report.txt",
    remotePath: "/srv/files/report.txt",
    bytesTransferred: 1024,
    durationMs: 1,
    averageSpeed: 1024000,
    success: true,
  }),
  uploadDirectory: vi.fn().mockResolvedValue({
    transferId: "upload-folder",
    direction: "upload",
    localPath: "C:\\tmp\\assets",
    remotePath: "/srv/files/assets",
    filesTransferred: 2,
    filesFailed: 0,
    filesSkipped: 0,
    totalBytes: 256,
    durationMs: 1,
    averageSpeed: 256000,
    errors: [],
  }),
  downloadDirectory: vi.fn().mockResolvedValue({
    transferId: "download-folder",
    direction: "download",
    localPath: "C:\\Downloads\\logs",
    remotePath: "/srv/files/logs",
    filesTransferred: 2,
    filesFailed: 0,
    filesSkipped: 0,
    totalBytes: 256,
    durationMs: 1,
    averageSpeed: 256000,
    errors: [],
  }),
  disconnect: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  mocks.hook.mockReset();
  mocks.open.mockReset();
  mocks.save.mockReset();
  mocks.hook.mockReturnValue(createModel());
  vi.restoreAllMocks();
});

describe("ScpClient", () => {
  it("renders real remote entries and navigation without advertising rename", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<ScpClient session={session} />);

    expect(
      screen.getByRole("region", { name: "SCP files on scp.example.test" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Remote SCP files" }),
    ).toHaveTextContent("report.txt");
    expect(screen.queryByRole("button", { name: /rename/i })).toBeNull();

    fireEvent.doubleClick(screen.getByText("logs"));
    await waitFor(() =>
      expect(model.loadDirectory).toHaveBeenCalledWith("/srv/files/logs"),
    );

    fireEvent.change(screen.getByLabelText("Remote path"), {
      target: { value: "/var/backups" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() =>
      expect(model.loadDirectory).toHaveBeenCalledWith("/var/backups"),
    );
  });

  it("uploads files and folders only after native path selection", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    mocks.open
      .mockResolvedValueOnce("C:\\tmp\\upload.txt")
      .mockResolvedValueOnce("C:\\tmp\\assets");
    render(<ScpClient session={session} />);

    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    await waitFor(() =>
      expect(model.uploadFile).toHaveBeenCalledWith(
        "C:\\tmp\\upload.txt",
        "/srv/files/upload.txt",
      ),
    );
    expect(
      screen.getByText("Uploaded 128 B to /srv/files/upload.txt."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload folder" }));
    await waitFor(() =>
      expect(model.uploadDirectory).toHaveBeenCalledWith(
        "C:\\tmp\\assets",
        "/srv/files/assets",
      ),
    );
    expect(mocks.open).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ directory: true, multiple: false }),
    );
  });

  it("downloads, verifies, and confirms deletion using backend operations", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    mocks.save.mockResolvedValue("C:\\Downloads\\report.txt");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ScpClient session={session} />);

    fireEvent.click(screen.getByText("report.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(model.downloadFile).toHaveBeenCalledWith(
        "/srv/files/report.txt",
        "C:\\Downloads\\report.txt",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Checksum" }));
    await waitFor(() =>
      expect(model.checksum).toHaveBeenCalledWith("/srv/files/report.txt"),
    );
    expect(screen.getByText("SHA-256: real-sha256")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(model.deleteEntry).toHaveBeenCalledWith(remoteEntries[1]),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      "Permanently delete report.txt?",
    );
  });

  it("uses recursive directory download and exposes a validated mkdir control", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    mocks.open.mockResolvedValue("C:\\Downloads");
    render(<ScpClient session={session} />);

    fireEvent.click(screen.getByText("logs"));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(model.downloadDirectory).toHaveBeenCalledWith(
        "/srv/files/logs",
        "C:\\Downloads\\logs",
      ),
    );

    fireEvent.change(screen.getByLabelText("New folder"), {
      target: { value: "archive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(model.mkdir).toHaveBeenCalledWith("/srv/files/archive"),
    );
  });
});
