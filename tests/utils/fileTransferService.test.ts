import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  FileTransferService,
  FileTransferAdapter,
} from "../../src/utils/file-transfer/fileTransferService";
import type { FileTransferSession } from "../../src/types/connection/connection";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import {
  joinRemotePath,
  normalizeRemotePath,
  safeRemoteEntryName,
} from "../../src/utils/file-transfer/fileTransferAdapters";

function createMockAdapter(): FileTransferAdapter {
  return {
    list: vi.fn(async () => []),
    async upload(file, _remotePath, onProgress, signal) {
      const total = (file as File).size;
      let transferred = 0;
      const chunk = total / 5;
      while (transferred < total) {
        if (signal?.aborted) throw new Error("aborted");
        await new Promise((res) => setTimeout(res, 100));
        if (signal?.aborted) throw new Error("aborted");
        transferred = Math.min(transferred + chunk, total);
        onProgress?.(transferred, total);
      }
    },
    async download(_remotePath, _localPath, onProgress, signal) {
      const total = 1000;
      let transferred = 0;
      const chunk = total / 5;
      while (transferred < total) {
        if (signal?.aborted) throw new Error("aborted");
        await new Promise((res) => setTimeout(res, 100));
        if (signal?.aborted) throw new Error("aborted");
        transferred = Math.min(transferred + chunk, total);
        onProgress?.(transferred, total);
      }
    },
  };
}

const TRANSFER_STORAGE_KEY = "mremote-file-transfers";

async function getStoredTransfer(transferId: string) {
  const sessions =
    (await IndexedDbService.getItem<FileTransferSession[]>(
      TRANSFER_STORAGE_KEY,
    )) ?? [];
  return sessions.find((session) => session.id === transferId);
}

describe("FileTransferService", () => {
  beforeEach(async () => {
    await IndexedDbService.init();
    await IndexedDbService.setItem(TRANSFER_STORAGE_KEY, []);
  });

  it("rejects traversal-shaped remote names and normalizes safe paths", () => {
    expect(safeRemoteEntryName("report.txt")).toBe("report.txt");
    expect(() => safeRemoteEntryName("../report.txt")).toThrow();
    expect(() => safeRemoteEntryName("dir/report.txt")).toThrow();
    expect(() => normalizeRemotePath("/safe/../escape")).toThrow();
    expect(joinRemotePath("/safe", "report.txt")).toBe("/safe/report.txt");
  });

  it("tracks uploads and emits progress", async () => {
    const service = new FileTransferService();
    service.registerAdapter("c1", createMockAdapter());
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    const progressSpy = vi.fn();
    let transferId = "";
    service.on("start", (session) => {
      transferId = session.id;
    });
    service.on("progress", progressSpy);

    await service.uploadFile("c1", file, "/remote/hello.txt");

    expect(progressSpy).toHaveBeenCalled();
    expect(await service.getActiveTransfers("c1")).toEqual([]);
    expect(await getStoredTransfer(transferId)).toEqual(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("tracks downloads and emits completion", async () => {
    const service = new FileTransferService();
    service.registerAdapter("c2", createMockAdapter());
    let transferId = "";
    service.on("start", (session) => {
      transferId = session.id;
    });

    await service.downloadFile("c2", "/remote/file.bin", "file.bin");

    expect(await service.getActiveTransfers("c2")).toEqual([]);
    expect(await getStoredTransfer(transferId)).toEqual(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("supports cancellation via AbortController", async () => {
    const service = new FileTransferService();
    service.registerAdapter("c3", createMockAdapter());
    const file = new File(["hello"], "hello.txt");

    let transferId = "";
    const errorSpy = vi.fn();
    service.on("error", errorSpy);
    service.on("start", (s) => {
      transferId = s.id;
      setTimeout(() => service.cancelTransfer(transferId), 150);
    });

    await expect(
      service.uploadFile("c3", file, "/remote/hello.txt"),
    ).rejects.toThrow("aborted");

    expect(await service.getActiveTransfers("c3")).toEqual([]);
    expect(await getStoredTransfer(transferId)).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: transferId, status: "cancelled" }),
    );
  });
});
