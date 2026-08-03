import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDB } from "idb";
import {
  SecureStorage,
  type StorageData,
} from "../../src/utils/storage/storage";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";

const DB_NAME = "mremote-keyval";
const STORE_NAME = "keyval";

beforeEach(async () => {
  await IndexedDbService.init();
  const db = await openDB(DB_NAME, 1);
  await db.clear(STORE_NAME);
  SecureStorage.clearPassword();
});

describe("SecureStorage", () => {
  it("rejects when loading encrypted data without a password", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const data: StorageData = {
        connections: [],
        settings: {},
        timestamp: Date.now(),
      };
      SecureStorage.setPassword("secret");
      await SecureStorage.saveData(data, true);
      SecureStorage.clearPassword();
      await expect(SecureStorage.loadData()).rejects.toThrow(
        "Password is required to load encrypted data",
      );
      expect(errorSpy.mock.calls).toEqual([
        [
          "Failed to load data:",
          expect.objectContaining({
            message: "Password is required to load encrypted data",
          }),
        ],
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("round-trips encrypted data with the correct password", async () => {
    const data: StorageData = {
      connections: [],
      settings: {},
      timestamp: Date.now(),
    };
    SecureStorage.setPassword("hunter2");
    await SecureStorage.saveData(data, true);
    SecureStorage.clearPassword();
    SecureStorage.setPassword("hunter2");
    const loaded = await SecureStorage.loadData();
    expect(loaded).toEqual(data);
  });

  it("throws when decrypting with the wrong password", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const data: StorageData = {
        connections: [],
        settings: {},
        timestamp: Date.now(),
      };
      SecureStorage.setPassword("correct");
      await SecureStorage.saveData(data, true);
      SecureStorage.clearPassword();
      SecureStorage.setPassword("wrong");
      await expect(SecureStorage.loadData()).rejects.toThrow(
        "Invalid password",
      );
      expect(errorSpy.mock.calls).toEqual([
        [
          "Failed to decrypt data:",
          expect.objectContaining({ name: "OperationError" }),
        ],
        [
          "Failed to load data:",
          expect.objectContaining({
            message: expect.stringMatching(/^Invalid password:/),
          }),
        ],
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
