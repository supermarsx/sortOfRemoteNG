import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { subscribeBrowserSessionProjectionChanges } from "../../src/utils/services/browserSessionProjectionEvents";
import { applyBrowserSessionProjection } from "../../src/utils/connection/browserSessionProjection";
import { stableJsonStringify } from "../../src/utils/core/stableJsonStringify";
import type { StorageData } from "../../src/utils/storage/storage";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: any) => void>(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, callback: (event: any) => void) => {
    bridge.listeners.set(name, callback);
    return () => {
      if (bridge.listeners.get(name) === callback)
        bridge.listeners.delete(name);
    };
  },
}));
let rows: ConnectionDatabase[];
let body: StorageData;
const descriptor = (letter: string) => ({
  version: 1 as const,
  records: [{ connectionId: "browser", revision: letter.repeat(64) }],
});
const withoutSessions = (data: StorageData) => {
  const { browserSessions: _projection, ...rest } = data;
  return rest;
};
const emit = (id = "owner") =>
  bridge.listeners.get("database-protection:browser-sessions-changed")?.({
    payload: { databaseId: id },
  });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

beforeEach(async () => {
  DatabaseManager.resetInstance();
  vi.restoreAllMocks();
  bridge.invoke.mockReset();
  bridge.listeners.clear();
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(
    async () => undefined,
  );
  rows = [
    {
      id: "owner",
      name: "Owner",
      isEncrypted: true,
      protectionFormat: "sorng-db",
      securityRevision: "revision",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      lastAccessed: "2026-01-01",
    },
  ];
  body = { connections: [], settings: { theme: "dark" }, timestamp: 0 };
  bridge.invoke.mockImplementation(async (command, args = {}) => {
    if (command === "databases_list")
      return { value: structuredClone(rows), source: "current" };
    if (command === "databases_save_index") {
      rows = structuredClone(args.list);
      return;
    }
    if (command === "load_database_data")
      return {
        value: JSON.stringify({
          format: "sorng-db",
          version: 1,
          ciphertext: "SYNTHETIC",
        }),
        source: "current",
      };
    if (
      ["database_protection_unlock", "database_protection_load"].includes(
        command,
      )
    )
      return {
        sessionId: "grant",
        sessionExpiresAt: null,
        securityRevision: "revision",
        data: structuredClone(body),
      };
    if (command === "database_browser_sessions_describe")
      return structuredClone(
        body.browserSessions ?? { version: 1, records: [] },
      );
    if (command === "database_protection_save") {
      if (
        stableJsonStringify(withoutSessions(args.expectedData)) !==
        stableJsonStringify(withoutSessions(body))
      )
        throw new Error("Native public body CAS rejected");
      expect(args.data.browserSessions).toEqual(
        args.expectedData.browserSessions,
      );
      body = {
        ...structuredClone(withoutSessions(args.data)),
        ...(body.browserSessions
          ? { browserSessions: body.browserSessions }
          : {}),
      };
      return {
        committed: true,
        cleanupPending: false,
        warnings: [],
        securityRevision: "revision",
      };
    }
    if (command === "database_protection_release_session")
      return { released: true };
    if (command === "database_protection_lock") {
      bridge.listeners.get("database-protection:locked")?.({
        payload: { databaseId: "owner" },
      });
      return { locked: true, notificationPending: false, warnings: [] };
    }
  });
});
afterEach(() => DatabaseManager.resetInstance());

async function open() {
  const manager = DatabaseManager.getInstance();
  await manager.unlockManagedDatabase("owner", "slot", "SYNTHETIC_UNLOCK");
  await manager.selectDatabase("owner");
  return { manager, target: manager.captureCurrentDatabaseDataTarget()! };
}

describe("owner-bound browser session projection (mocked native IPC)", () => {
  it("updates only native descriptors and the captured descriptor CAS while retaining a pending draft and ledger", async () => {
    const { target } = await open();
    const draft = (await target.load())!;
    draft.settings.theme = "unsaved-edit";
    const before = structuredClone(body);
    body.browserSessions = descriptor("a");
    bridge.invoke.mockClear();
    const projection = await target.refreshBrowserSessionProjection!();
    expect(projection).toEqual({
      browserSessions: descriptor("a"),
      recordMetadata: before.recordMetadata,
    });
    expect(withoutSessions(body)).toEqual(withoutSessions(before));
    expect(bridge.invoke.mock.calls.map(([command]) => command)).not.toContain(
      "database_protection_save",
    );
    const patched = applyBrowserSessionProjection(draft, projection);
    expect(patched.settings.theme).toBe("unsaved-edit");
    await target.save(patched);
    expect(body.settings.theme).toBe("unsaved-edit");
    expect(body.browserSessions).toEqual(descriptor("a"));
  });

  it("removes stale descriptors when native retention is deleted without creating ledger events", async () => {
    body.browserSessions = descriptor("a");
    const { target } = await open();
    const draft = (await target.load())!;
    const ledger = structuredClone(body.recordMetadata);
    delete body.browserSessions;
    const projection = await target.refreshBrowserSessionProjection!();
    expect(projection.browserSessions).toBeUndefined();
    expect(projection.recordMetadata).toEqual(ledger);
    await target.save(applyBrowserSessionProjection(draft, projection));
    expect(body.browserSessions).toBeUndefined();
  });

  it("rejects real external public edits without adopting them into the editor baseline", async () => {
    const { target } = await open();
    const draft = (await target.load())!;
    body.settings.theme = "another-window";
    body.browserSessions = descriptor("b");
    await expect(target.refreshBrowserSessionProjection!()).rejects.toThrow(
      /body changed/,
    );
    expect(draft.settings.theme).toBe("dark");
    await expect(target.save(draft)).rejects.toThrow(/CAS rejected/);
    expect(body.settings.theme).toBe("another-window");
  });

  it("does not bless a public-body write racing the final describe response", async () => {
    const { target } = await open();
    const draft = (await target.load())!;
    const previous = bridge.invoke.getMockImplementation()!;
    let complete!: (value: unknown) => void;
    bridge.invoke.mockImplementation((command, args) =>
      command === "database_browser_sessions_describe"
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : previous(command, args),
    );
    const pending = target.refreshBrowserSessionProjection!();
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    body.settings.theme = "racing-writer";
    body.browserSessions = descriptor("c");
    complete(descriptor("c"));
    const projection = await pending;
    await expect(
      target.save(applyBrowserSessionProjection(draft, projection)),
    ).rejects.toThrow(/CAS rejected/);
    expect(body.settings.theme).toBe("racing-writer");
  });

  it("authenticates native hints via describe, ignores activity/duplicate hints, and keeps the grant private", async () => {
    await open();
    const changes = vi.fn();
    const off = subscribeBrowserSessionProjectionChanges(changes);
    try {
      emit("other");
      await flush();
      expect(changes).not.toHaveBeenCalled();
      emit();
      await flush();
      expect(changes).not.toHaveBeenCalled();
      body.browserSessions = descriptor("a");
      emit();
      await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
      emit();
      await flush();
      expect(changes).toHaveBeenCalledTimes(1);
      const notification = changes.mock.calls[0][0];
      expect(Object.keys(notification).sort()).toEqual([
        "assertCurrent",
        "changeId",
        "databaseId",
      ]);
      expect(JSON.stringify(notification)).not.toContain("grant");
      expect(bridge.invoke).toHaveBeenCalledWith(
        "database_browser_sessions_describe",
        {
          databaseId: "owner",
          sessionId: "grant",
          expectedSecurityRevision: "revision",
        },
      );
    } finally {
      off();
    }
  });

  it.each(["event", "target"])(
    "rejects a delayed %s describe when ownership is revoked",
    async (operation) => {
      const { manager, target } = await open();
      const previous = bridge.invoke.getMockImplementation()!;
      let release!: (value: unknown) => void;
      bridge.invoke.mockImplementation((command, args) =>
        command === "database_browser_sessions_describe"
          ? new Promise((resolve) => {
              release = resolve;
            })
          : previous(command, args),
      );
      const changes = vi.fn();
      const off = subscribeBrowserSessionProjectionChanges(changes);
      try {
        let pending: Promise<unknown> | undefined;
        if (operation === "event") emit();
        else pending = target.refreshBrowserSessionProjection!();
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        manager.invalidatePendingDatabaseOperations();
        release(descriptor("b"));
        if (pending) await expect(pending).rejects.toThrow();
        await flush();
        expect(changes).not.toHaveBeenCalled();
      } finally {
        off();
      }
    },
  );
});
