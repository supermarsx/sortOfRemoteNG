import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { FileTransferManager } from "../src/components/protocol/FileTransferManager";

const mocks = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  getActiveTransfers: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
  resumeTransfer: vi.fn(),
}));

vi.mock("../src/utils/fileTransferService", () => ({
  FileTransferService: class {
    listDirectory = mocks.listDirectory;
    getActiveTransfers = mocks.getActiveTransfers;
    uploadFile = mocks.uploadFile;
    downloadFile = mocks.downloadFile;
    deleteFile = mocks.deleteFile;
    resumeTransfer = mocks.resumeTransfer;
  },
}));

describe("FileTransferManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.listDirectory.mockResolvedValue([
      {
        name: "file1.txt",
        type: "file",
        size: 1024,
        modified: new Date("2026-01-01T00:00:00.000Z"),
        permissions: "rw-r--r--",
      },
      {
        name: "docs",
        type: "directory",
        size: 0,
        modified: new Date("2026-01-01T00:00:00.000Z"),
        permissions: "drwxr-xr-x",
      },
    ]);

    mocks.getActiveTransfers.mockResolvedValue([
      {
        id: "tr-1",
        connectionId: "conn-1",
        type: "download",
        localPath: "file1.txt",
        remotePath: "/file1.txt",
        progress: 50,
        status: "active",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        totalSize: 200,
        transferredSize: 100,
      },
      {
        id: "tr-2",
        connectionId: "conn-1",
        type: "download",
        localPath: "file2.txt",
        remotePath: "/file2.txt",
        progress: 10,
        status: "error",
        error: "network error",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        totalSize: 100,
        transferredSize: 10,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render when closed", () => {
    render(
      <FileTransferManager
        isOpen={false}
        onClose={() => {}}
        connectionId="conn-1"
        protocol="sftp"
      />,
    );

    expect(screen.queryByText("File Transfer - SFTP")).not.toBeInTheDocument();
  });

  it("renders files and transfers when opened", async () => {
    render(
      <FileTransferManager
        isOpen
        onClose={() => {}}
        connectionId="conn-1"
        protocol="sftp"
      />,
    );

    expect(await screen.findByText("File Transfer - SFTP")).toBeInTheDocument();
    expect((await screen.findAllByText("file1.txt")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Active Transfers")).toBeInTheDocument();
  });

  it("closes on backdrop click", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <FileTransferManager
        isOpen
        onClose={onClose}
        connectionId="conn-1"
        protocol="sftp"
      />,
    );

    await screen.findByText("File Transfer - SFTP");
    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on Escape key", async () => {
    const onClose = vi.fn();
    render(
      <FileTransferManager
        isOpen
        onClose={onClose}
        connectionId="conn-1"
        protocol="sftp"
      />,
    );

    await screen.findByText("File Transfer - SFTP");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("downloads selected file", async () => {
    render(
      <FileTransferManager
        isOpen
        onClose={() => {}}
        connectionId="conn-1"
        protocol="sftp"
      />,
    );

    const fileNameElements = await screen.findAllByText("file1.txt");
    fireEvent.click(fileNameElements[0]);
    fireEvent.click(screen.getByText("Download"));

    await waitFor(() => {
      expect(mocks.downloadFile).toHaveBeenCalledWith(
        "conn-1",
        "/file1.txt",
        "file1.txt",
      );
    });
  });

  it("shows upload dialog and closes it via cancel", async () => {
    render(
      <FileTransferManager
        isOpen
        onClose={() => {}}
        connectionId="conn-1"
        protocol="sftp"
      />,
    );

    fireEvent.click(await screen.findByText("Upload"));
    expect(await screen.findByText("Upload Files")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => {
      expect(screen.queryByText("Upload Files")).not.toBeInTheDocument();
    });
  });

  it("resumes errored downloads from transfer queue", async () => {
    render(
      <FileTransferManager
        isOpen
        onClose={() => {}}
        connectionId="conn-1"
        protocol="sftp"
      />,
    );

    const resumeButton = await screen.findByRole("button", { name: "Resume" });
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(mocks.resumeTransfer).toHaveBeenCalledWith("tr-2");
    });
  });
});
