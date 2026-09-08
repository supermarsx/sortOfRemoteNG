import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDatabaseBulkExport,
  saveDatabaseBulkExport,
} from "../../src/utils/connection/databaseBulkExport";
import { defaultExportSecuritySettings } from "../../src/types/settings/settings";
import type { DatabaseExportSnapshot } from "../../src/utils/connection/databaseManager";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: mocks.writeFile }));

const snapshot: DatabaseExportSnapshot = {
  collection: {
    id: "fixture",
    name: "Fixture",
    isEncrypted: false,
    exportDate: "2026-01-01",
  },
  connections: [],
  tabGroups: [],
  colorTags: {},
  settings: {
    password: "secret",
    nested: { apiKey: "another-secret", theme: "dark" },
  },
};
beforeEach(() => vi.clearAllMocks());

describe("native bulk database export", () => {
  it("retains the established import schema while stripping secrets from settings", () => {
    const payload = buildDatabaseBulkExport([snapshot]);
    expect(payload.schema).toBe("sortOfRemoteNG.database-export-package");
    expect(payload.version).toBe(1);
    expect(payload.databases[0].settings).toEqual({
      nested: { theme: "dark" },
    });
    expect(snapshot.settings.password).toBe("secret");
  });
  it("does not write when the native Save dialog is cancelled", async () => {
    mocks.save.mockResolvedValue(null);
    expect(
      await saveDatabaseBulkExport(
        [snapshot],
        {
          encrypted: false,
          password: "",
          security: defaultExportSecuritySettings,
        },
        () => false,
      ),
    ).toBe("cancelled");
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
  it("honors export password policy before displaying or writing a file", async () => {
    await expect(
      saveDatabaseBulkExport(
        [snapshot],
        {
          encrypted: true,
          password: "",
          security: defaultExportSecuritySettings,
        },
        () => false,
      ),
    ).rejects.toThrow("Enter a password");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
