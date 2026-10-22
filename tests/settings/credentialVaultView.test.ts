import { describe, expect, it } from "vitest";
import { normalizeCredentialVaultView } from "../../src/utils/settings/credentialVaultView";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";

describe("credential vault list preferences", () => {
  it("defaults to 100 compact rows and validates untrusted saved preferences", () => {
    expect(normalizeCredentialVaultView(undefined)).toMatchObject({
      pageSize: 100,
      mode: "paged",
      widths: { assigned: 160 },
    });
    expect(
      normalizeCredentialVaultView({
        columns: ["assigned", "SECRET"],
        widths: { assigned: Infinity, name: -100, source: 9000 },
        pageSize: 100000,
        mode: "unsafe",
      }),
    ).toEqual({
      columns: ["name", "assigned", "actions"],
      widths: {
        name: 120,
        source: 640,
        categories: 200,
        assigned: 160,
        actions: 96,
      },
      pageSize: 100,
      mode: "paged",
    });
  });
  it("persists layout and navigation through the existing settings store", async () => {
    _resetInMemorySettingsStore();
    SettingsManager.resetInstance();
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    const view = normalizeCredentialVaultView({
      columns: ["name", "assigned", "actions"],
      widths: { assigned: 120 },
      pageSize: 50,
      mode: "infinite",
    });
    await manager.saveSettings({ credentialVaultView: view });
    SettingsManager.resetInstance();
    expect(
      (await SettingsManager.getInstance().loadSettings()).credentialVaultView,
    ).toEqual(view);
    _resetInMemorySettingsStore();
    SettingsManager.resetInstance();
  });
});
