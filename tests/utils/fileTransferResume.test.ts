import { describe, it, expect, beforeEach } from "vitest";
import {
  FileTransferService,
  FileTransferAdapter,
  FileItem,
} from "../../src/utils/file-transfer/fileTransferService";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import type { FileTransferSession } from "../../src/types/connection/connection";
import { openDB } from "idb";

const DB_NAME = "mremote-keyval";
const STORE_NAME = "keyval";
const TRANSFER_STORAGE_KEY = "mremote-file-transfers";

async function getStoredTransfer(transferId: string) {
  const sessions =
    (await IndexedDbService.getItem<FileTransferSession[]>(
      TRANSFER_STORAGE_KEY,
    )) ?? [];
  return sessions.find((session) => session.id === transferId);
}

class StubAdapter implements FileTransferAdapter {
  async list(_path: string): Promise<FileItem[]> {
    return [];
  }
  async upload(
    file: any,
    _remotePath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const total = file.size ?? 100;
    let transferred = 0;
    while (transferred < total) {
      if (signal?.aborted) throw new Error("aborted");
      await new Promise((res) => setTimeout(res, 10));
      transferred += 20;
      onProgress?.(transferred, total);
    }
  }
  async download(
    _remotePath: string,
    _localPath: string,
    _onProgress?: (transferred: number, total: number) => void,
    _signal?: AbortSignal,
  ): Promise<void> {
    // not needed for this test
  }
}

describe("FileTransferService resumeTransfer", () => {
  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB(DB_NAME, 1);
    await db.clear(STORE_NAME);
  });

  it("persists and resumes an interrupted upload", async () => {
    const adapter = new StubAdapter();
    const service = new FileTransferService();
    service.registerAdapter("c1", adapter);
    const file: any = { name: "test.txt", size: 100 };

    let transferId = "";
    service.on("start", (session) => {
      transferId = session.id;
    });

    const promise = service.uploadFile("c1", file, "/remote");
    await new Promise((res) => setTimeout(res, 25));
    service.cancelTransfer(transferId);
    await expect(promise).rejects.toThrow("aborted");

    expect(await service.getActiveTransfers("c1")).toEqual([]);
    let stored = await getStoredTransfer(transferId);
    expect(stored).toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(stored!.transferredSize).toBeLessThan(stored!.totalSize);

    const service2 = new FileTransferService();
    service2.registerAdapter("c1", adapter);
    await service2.resumeTransfer(transferId, file);
    expect(await service2.getActiveTransfers("c1")).toEqual([]);
    stored = await getStoredTransfer(transferId);
    expect(stored).toEqual(expect.objectContaining({ status: "completed" }));
    expect(stored!.transferredSize).toBe(stored!.totalSize);
  });
});
