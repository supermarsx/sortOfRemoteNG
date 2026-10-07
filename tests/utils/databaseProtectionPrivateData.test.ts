import { beforeEach, describe, expect, it, vi } from "vitest";
import { databaseProtection } from "../../src/utils/connection/databaseProtection";
import type { DatabaseProtectionChangeRequest } from "../../src/types/encryption/databaseProtection";
import {
  assertPublicDatabaseData,
  NativePrivateDataError,
} from "../../src/utils/storage/nativePrivateData";
import { snapshotRecordPayload } from "../../src/utils/storage/recordLedger";
import { SecureStorage } from "../../src/utils/storage/storage";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));

const publicData = () => ({ connections: [], settings: {}, timestamp: 0 });
const privateData = () => ({
  ...publicData(),
  nativeBrowserSessions: { secret: "SYNTHETIC_COOKIE_AND_KEY" },
});
beforeEach(() => {
  bridge.invoke.mockReset();
});

describe("native browser session private-data boundary", () => {
  it.each([undefined, null, {}, []])(
    "rejects even an empty private field (%j) without reporting its value",
    (nativeBrowserSessions) => {
      const value = { ...publicData(), nativeBrowserSessions };
      expect(() => assertPublicDatabaseData(value)).toThrow(
        NativePrivateDataError,
      );
    },
  );

  it("does not invoke a private accessor or copy the private payload into history", () => {
    const getter = vi.fn(() => "SYNTHETIC_COOKIE_AND_KEY");
    const value = Object.defineProperty(publicData(), "nativeBrowserSessions", {
      enumerable: true,
      get: getter,
    });
    expect(() => snapshotRecordPayload(value)).toThrow(NativePrivateDataError);
    expect(getter).not.toHaveBeenCalled();
    expect(() => snapshotRecordPayload(privateData())).toThrow(
      /Native-private browser session data/,
    );
    expect(new NativePrivateDataError().message).not.toContain("SYNTHETIC_");
  });

  it("preserves public payloads and unrelated user-authored document text", () => {
    const value = {
      ...publicData(),
      settings: { note: "nativeBrowserSessions" },
    };
    expect(() => assertPublicDatabaseData(value)).not.toThrow();
    expect(snapshotRecordPayload(value)).toEqual(value);
  });

  it.each(["load", "unlock"] as const)(
    "rejects private material from the ordinary managed %s result",
    async (operation) => {
      bridge.invoke.mockResolvedValue({ data: privateData() });
      const pending =
        operation === "load"
          ? databaseProtection.load("database", "session", "revision")
          : databaseProtection.unlock("database", "slot");
      await expect(pending).rejects.toThrow(NativePrivateDataError);
    },
  );

  it("does not send private proposed or expected content through ordinary save", async () => {
    await expect(
      databaseProtection.save(
        "database",
        "session",
        "revision",
        privateData(),
        publicData(),
      ),
    ).rejects.toThrow(NativePrivateDataError);
    await expect(
      databaseProtection.save(
        "database",
        "session",
        "revision",
        publicData(),
        privateData(),
      ),
    ).rejects.toThrow(NativePrivateDataError);
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("does not send native-private legacy initialization or expected data", async () => {
    const request: DatabaseProtectionChangeRequest = {
      databaseId: "database",
      expectedSecurityRevision: "revision",
      expectedData: publicData(),
      legacyVerifiedData: privateData(),
      target: null,
    };
    await expect(databaseProtection.change(request)).rejects.toThrow(
      NativePrivateDataError,
    );
    await expect(
      databaseProtection.change({
        ...request,
        legacyVerifiedData: publicData(),
        expectedData: privateData(),
      }),
    ).rejects.toThrow(NativePrivateDataError);
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("blocks generic storage writers before serialization or IPC", async () => {
    await expect(SecureStorage.saveData(privateData(), true)).rejects.toThrow(
      NativePrivateDataError,
    );
    await expect(SecureStorage.saveDataVault(privateData())).rejects.toThrow(
      NativePrivateDataError,
    );
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("does not silently treat a private vault-load result as an empty database", async () => {
    bridge.invoke.mockResolvedValue(JSON.stringify(privateData()));
    await expect(SecureStorage.loadDataVault()).rejects.toThrow(
      NativePrivateDataError,
    );
  });

  it("passes the explicit transfer password and exact public selection only to native export", async () => {
    const selected = {
      version: 1 as const,
      records: [{ connectionId: "connection", revision: "a".repeat(64) }],
    };
    const capsule = {
      version: 1,
      ciphertext: "native-password-sealed-capsule",
    };
    bridge.invoke.mockResolvedValue(capsule);
    await expect(
      databaseProtection.exportBrowserSessions(
        "database",
        "session",
        "revision",
        selected,
        "archive-password",
      ),
    ).resolves.toEqual(capsule);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_browser_sessions_export",
      {
        databaseId: "database",
        sessionId: "session",
        expectedSecurityRevision: "revision",
        selected,
        password: "archive-password",
      },
    );
    bridge.invoke.mockRejectedValue(new Error("PRIVATE_BACKEND_COOKIE"));
    await expect(
      databaseProtection.exportBrowserSessions(
        "database",
        "session",
        "revision",
        selected,
        "archive-password",
      ),
    ).rejects.toThrow(/Browser session data/);
  });
});
