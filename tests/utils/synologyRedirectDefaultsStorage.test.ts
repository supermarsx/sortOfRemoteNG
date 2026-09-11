import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import {
  SecureStorage,
  type StorageData,
} from "../../src/utils/storage/storage";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
const connection = (): Connection => ({
  id: "nas",
  name: "NAS",
  protocol: "https",
  hostname: "nas.quickconnect.to",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-11",
  updatedAt: "2026-09-11",
  synologySettings: {
    version: 1,
    useHttps: true,
    useDefaultRedirectDestinations: false,
  },
  httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
});
const data = (recycled: boolean): StorageData => ({
  connections: recycled ? [] : [connection()],
  settings: {},
  timestamp: 1,
  ...(recycled
    ? {
        recycleBin: {
          version: 1 as const,
          revision: "fixture",
          policy: { mode: "forever" as const },
          entries: [
            {
              id: "removed",
              batchId: "batch",
              deletedAt: 1,
              connection: connection(),
            },
          ],
        },
      }
    : {}),
});
beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue(undefined);
});
describe("Synology runtime context raw storage guards", () => {
  it.each([false, true])(
    "rejects active/recycled forged context before any persistence or mutation (recycled=%s)",
    async (recycled) => {
      for (const placement of ["policy", "connection"] as const) {
        const input = data(recycled);
        const target = recycled
          ? input.recycleBin!.entries[0].connection
          : input.connections[0];
        const value = {
          version: 1,
          originalOrigin: "https://private-source.quickconnect.to",
        };
        if (placement === "policy")
          Object.assign(target.httpProxyPolicy!, {
            synologyQuickConnectDefaults: value,
          });
        else Object.assign(target, { synologyQuickConnectDefaults: value });
        const before = JSON.stringify(input);
        const manager = new DatabaseManager();
        const lookup = vi.spyOn(manager, "getDatabase");
        for (const save of [
          () => SecureStorage.saveData(input),
          () => SecureStorage.saveDataVault(input),
          () => manager.saveDatabaseData("db", input),
        ]) {
          await expect(save()).rejects.toThrow(
            "Runtime redirect context cannot be saved",
          );
        }
        expect(native.invoke).not.toHaveBeenCalled();
        expect(lookup).not.toHaveBeenCalled();
        expect(JSON.stringify(input)).toBe(before);
        lookup.mockRestore();
      }
    },
  );
  it("preserves false and recycled records at both native secure-storage boundaries", async () => {
    const input = data(true),
      before = JSON.stringify(input);
    await SecureStorage.saveData(input, true);
    expect(native.invoke).toHaveBeenCalledWith("save_data", {
      data: input,
      usePassword: true,
    });
    await SecureStorage.saveDataVault(input);
    expect(native.invoke).toHaveBeenCalledWith("vault_save_storage", {
      jsonData: before,
    });
    expect(JSON.stringify(input)).toBe(before);
  });
});
