import { describe, expect, it } from "vitest";
import {
  normalizeCredentialVaultView,
  credentialInventoryMatches,
  compareCredentialInventory,
  EMPTY_CREDENTIAL_FILTERS,
  type CredentialInventoryViewMetadata,
} from "../../src/utils/settings/credentialVaultView";
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
        types: 240,
        categories: 200,
        assigned: 160,
        updated: 180,
        actions: 288,
      },
      pageSize: 100,
      mode: "paged",
    });
  });
  it("includes new metadata columns by default while respecting saved visibility and bounded widths", () => {
    expect(
      normalizeCredentialVaultView({ widths: { actions: 96 } }).widths.actions,
    ).toBe(256);
    expect(normalizeCredentialVaultView(undefined).columns).toContain("types");
    expect(normalizeCredentialVaultView(undefined).columns).toContain(
      "updated",
    );
    const view = normalizeCredentialVaultView({
      columns: ["name", "types", "updated", "actions"],
      widths: { types: -1, updated: 9000 },
    });
    expect(view.columns).toEqual(["name", "types", "updated", "actions"]);
    expect(view.widths).toMatchObject({ types: 120, updated: 640 });
    expect(
      normalizeCredentialVaultView({ columns: ["name", "assigned", "actions"] })
        .columns,
    ).toEqual(["name", "assigned", "actions"]);
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

const row: CredentialInventoryViewMetadata = {
  key: "vault:one",
  name: "Alpha",
  source: "vault",
  types: ["password"],
  tags: ["Finance"],
  protocols: ["https"],
  applications: ["Webmin"],
  assignment: "assigned",
  storage: ["vault"],
  updatedAt: "2026-11-01T00:00:00Z",
};
describe("credential inventory metadata view", () => {
  it("ANDs all explicit metadata filters without inferring tags from types or protocols", () => {
    const filters = {
      type: "password",
      tag: "Finance",
      protocol: "https",
      application: "Webmin",
      assignment: "assigned",
      storage: "vault",
    };
    expect(credentialInventoryMatches(row, filters)).toBe(true);
    for (const key of Object.keys(filters) as (keyof typeof filters)[]) {
      expect(
        credentialInventoryMatches(row, { ...filters, [key]: "mismatch" }),
      ).toBe(false);
    }
    expect(
      credentialInventoryMatches(
        { ...row, tags: [] },
        { ...EMPTY_CREDENTIAL_FILTERS, tag: "User/password" },
      ),
    ).toBe(false);
    expect(
      credentialInventoryMatches(
        { ...row, assignment: "unavailable" },
        { ...EMPTY_CREDENTIAL_FILTERS, assignment: "unassigned" },
      ),
    ).toBe(false);
  });
  it("sorts metadata deterministically and keeps unknown timestamps last in both directions", () => {
    const newer = {
      ...row,
      key: "vault:two",
      name: "Beta",
      updatedAt: "2026-11-02T00:00:00Z",
    };
    const unknown = {
      ...row,
      key: "connection:one",
      source: "connection" as const,
      updatedAt: null,
    };
    expect(compareCredentialInventory(row, newer, "name", "asc")).toBeLessThan(
      0,
    );
    expect(
      compareCredentialInventory(row, newer, "updated", "desc"),
    ).toBeGreaterThan(0);
    for (const direction of ["asc", "desc"] as const) {
      expect(
        compareCredentialInventory(row, unknown, "updated", direction),
      ).toBeLessThan(0);
      expect(
        compareCredentialInventory(unknown, row, "updated", direction),
      ).toBeGreaterThan(0);
    }
    expect(
      compareCredentialInventory(
        row,
        { ...row, key: "vault:two" },
        "updated",
        "asc",
      ),
    ).toBeLessThan(0);
  });
});
