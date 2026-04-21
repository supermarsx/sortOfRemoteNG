import { describe, it, expect, vi, beforeEach } from "vitest";

// The FTP adapter uses a dynamic import of "basic-ftp". The former
// `SFTPAdapter` (ssh2-sftp-client) and `SCPAdapter` (node-ssh) were retired in
// t3-e41 — SFTP/SCP now flow through the Tauri `sorng-sftp` + `sorng-ssh`
// backends, covered by separate integration tests.

const mockFTPClient = {
  access: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue([]),
  uploadFrom: vi.fn().mockResolvedValue(undefined),
  downloadTo: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
};

vi.mock("basic-ftp", () => ({
  Client: vi.fn(() => mockFTPClient),
}));

// We also mock "stream" since the code uses Readable.from
vi.mock("stream", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    default: actual,
    Readable: {
      ...actual.Readable,
      from: vi.fn((buf: any) => buf),
    },
  };
});

import {
  FTPAdapter,
  type FileItem,
} from "../../src/utils/file-transfer/fileTransferAdapters";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset "connected" state: clear cached client by re-creating
  mockFTPClient.access.mockResolvedValue(undefined);
});

// ---------- FTPAdapter ----------
describe("FTPAdapter", () => {
  const config = { host: "ftp.test", port: 21, username: "user", password: "pass", secure: false };

  it("connects and lists files, mapping to FileItem[]", async () => {
    mockFTPClient.list.mockResolvedValue([
      { name: "readme.md", isDirectory: false, size: 1024, modifiedAt: new Date("2024-06-01") },
      { name: "src", isDirectory: true, size: 0, modifiedAt: new Date("2024-04-01") },
    ]);

    const adapter = new FTPAdapter(config);
    const items = await adapter.list("/home");

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({ name: "readme.md", type: "file", size: 1024 }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({ name: "src", type: "directory" }),
    );
  });

  it("throws when list is called with an aborted signal", async () => {
    const adapter = new FTPAdapter(config);
    const ac = new AbortController();
    ac.abort();
    await expect(adapter.list("/any", ac.signal)).rejects.toThrow("aborted");
  });

  it("uploads a buffer via FTP", async () => {
    const adapter = new FTPAdapter(config);
    const buf = Buffer.from("hello");
    await adapter.upload(buf, "/remote/file.txt");

    expect(mockFTPClient.uploadFrom).toHaveBeenCalledWith(
      expect.anything(),
      "/remote/file.txt",
    );
  });

  it("downloads a file via FTP", async () => {
    const adapter = new FTPAdapter(config);
    await adapter.download("/remote/file.txt", "/local/file.txt");

    expect(mockFTPClient.downloadTo).toHaveBeenCalledWith(
      "/local/file.txt",
      "/remote/file.txt",
    );
  });

  it("deletes a remote file", async () => {
    const adapter = new FTPAdapter(config);
    await adapter.delete("/remote/old.txt");
    expect(mockFTPClient.remove).toHaveBeenCalledWith("/remote/old.txt");
  });

  it("creates a directory via ensureDir", async () => {
    const adapter = new FTPAdapter(config);
    await adapter.mkdir("/remote/new-dir");
    expect(mockFTPClient.ensureDir).toHaveBeenCalledWith("/remote/new-dir");
  });

  it("renames a remote path", async () => {
    const adapter = new FTPAdapter(config);
    await adapter.rename("/old", "/new");
    expect(mockFTPClient.rename).toHaveBeenCalledWith("/old", "/new");
  });
});

// SFTPAdapter (ssh2-sftp-client) and SCPAdapter (node-ssh) tests were removed
// in t3-e41 together with their backing classes. TauriSFTPAdapter has its own
// integration coverage via the Tauri invoke mocks in sftp-specific suites.
