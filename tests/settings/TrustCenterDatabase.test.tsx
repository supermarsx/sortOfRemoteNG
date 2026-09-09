/**
 * t62 / D7 — the Trust Center's database surface.
 *
 * Covers the banner (which database, encrypted or plaintext, how many
 * records), JSON export / import through the app's file dialogs, the
 * known_hosts importer, and the legacy-sidecar cleanup with its confirm step.
 *
 * `src/utils/services/trustPortability.ts` is deliberately **not** mocked: it
 * is the seam that actually speaks `trust_export_database` /
 * `trust_import_database`, so letting it run keeps the assertions about the
 * native call shape honest. Only `getInvoke` underneath it is faked.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
// The real i18next instance, so the new `trustCenter.*` en-US strings and
// their {{interpolations}} are exercised rather than a fallback that returns
// the key. react-i18next's not-ready `t` does not interpolate.
import i18n, { loadLanguage } from "../../src/i18n";
import { TrustVerificationSettings } from "../../src/components/SettingsDialog/sections/TrustVerificationSettings";

/* ── Fixtures shared with the mocks ─────────────────────────────────── */

interface Scope {
  databaseId: string | null;
  encrypted: boolean;
  recordCount: number;
  seededRecords: number;
  resolved: boolean;
}

let scope: Scope;
let currentDatabase: { id: string; name: string } | null;
let legacyStatus: Record<string, unknown> | null;
let invokeMock: ReturnType<typeof vi.fn>;
let savePath: string | null;
let openPath: string | null;
let fileContents: string;
let writtenFiles: Array<[string, string]>;
const forceToken = "11111111-1111-4111-8111-111111111111";
let forcePreview: Record<string, unknown>;
let forceResult: Record<string, unknown>;
let databaseRows: Array<{
  id: string;
  name: string;
  isEncrypted: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessed: string;
  protectionFormat?: "sorng-db";
}>;
const unlocked = new Set<string>();
const migrateDatabase = vi.fn();
const unlockDatabase = vi.fn(async (id: string) => {
  unlocked.add(id);
});
const selectDatabase = vi.fn();

const saveDialog = vi.fn(async () => savePath);
const openDialog = vi.fn(async () => openPath);
const writeTextFile = vi.fn(async (path: string, contents: string) => {
  writtenFiles.push([path, contents]);
});
const readTextFile = vi.fn(async () => fileContents);

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveDialog(...(args as [])),
  open: (...args: unknown[]) => openDialog(...(args as [])),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (...args: unknown[]) =>
    writeTextFile(...(args as [string, string])),
  readTextFile: (...args: unknown[]) => readTextFile(...(args as [])),
}));

vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: () => Promise.resolve(invokeMock),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { connections: [] } }),
}));

vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => currentDatabase,
      getAllDatabases: async () => databaseRows,
      isDatabaseUnlocked: (id: string) => unlocked.has(id),
      unlockDatabase,
      migrateLegacyTrustDatabase: migrateDatabase,
      selectDatabase,
    }),
  },
  onCurrentDatabaseChange: () => () => undefined,
}));

vi.mock("../../src/utils/auth/trustStore", () => ({
  getAllTrustRecords: vi.fn(() => []),
  getAllPerConnectionTrustRecords: vi.fn(() => []),
  ensureTrustStoreReady: vi.fn(() => Promise.resolve()),
  retryTrustStoreHydration: vi.fn(() => Promise.resolve()),
  refreshTrustStoreRecords: vi.fn(() => Promise.resolve()),
  getTrustStoreAvailability: vi.fn(() => ({ state: "ready" })),
  getTrustStoreScope: vi.fn(() => scope),
  refreshTrustStoreScope: vi.fn(() => Promise.resolve(scope)),
  removeIdentity: vi.fn(),
  clearEntireTrustStore: vi.fn(),
  parseTrustRecordAddress: vi.fn(() => ({ host: "h", port: 1 })),
  setTrustRecordPolicy: vi.fn(),
  setTrustRecordRevoked: vi.fn(),
  updateTrustRecordNickname: vi.fn(),
  resolveEffectiveTrustPolicy: vi.fn(() => "tofu"),
  formatFingerprint: vi.fn((value: string) => value),
}));

const settings = {
  trustPolicy: "tofu",
  certificateTrustPolicy: "inherit",
  httpsTrustPolicy: "inherit",
  sshTrustPolicy: "always-ask",
  rdpTrustPolicy: "inherit",
  showTrustIdentityInfo: true,
  certExpiryWarningDays: 5,
} as unknown as GlobalSettings;

const trustDocument = {
  version: 1,
  records: [
    {
      host: "ssh.example.local:22",
      record_type: "ssh",
      identity: { fingerprint: "aa:bb", last_seen: "2026-01-02T00:00:00Z" },
      user_approved: true,
    },
  ],
  policy: "tofu",
};

const openTrustCenter = vi.fn();
function renderSection() {
  return render(
    <TrustVerificationSettings
      settings={settings}
      updateSettings={vi.fn()}
      onOpenTrustCenter={openTrustCenter}
    />,
  );
}

/** Wait for the mount-time `trust_legacy_status` round trip to settle. */
async function settle() {
  await waitFor(() => expect(invokeMock).toHaveBeenCalled());
}

beforeEach(async () => {
  openTrustCenter.mockClear();
  await i18n.changeLanguage("en-US");
  scope = {
    databaseId: "db-1",
    encrypted: true,
    recordCount: 3,
    seededRecords: 0,
    resolved: true,
  };
  currentDatabase = { id: "db-1", name: "Production" };
  legacyStatus = {
    legacyPresent: false,
    legacyRecords: 0,
    rdpLegacyPresent: false,
    rdpLegacyRecords: 0,
    allDatabasesOpened: true,
    canDeleteLegacy: true,
    pendingDatabaseIds: [],
    verifiedDatabaseIds: [],
    blockers: [],
  };
  databaseRows = [
    {
      id: "db-1",
      name: "Production",
      isEncrypted: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      lastAccessed: "2026-01-01",
    },
  ];
  unlocked.clear();
  unlockDatabase.mockClear();
  selectDatabase.mockClear();
  migrateDatabase
    .mockReset()
    .mockImplementation(async (databaseId: string) => ({
      databaseId,
      status: "migrated",
      migratedRecords: 2,
      preservedRecords: 1,
      warnings: [],
    }));
  savePath = "/tmp/trust.json";
  openPath = "/tmp/trust.json";
  fileContents = JSON.stringify(trustDocument);
  writtenFiles = [];
  forcePreview = {
    token: forceToken,
    expiresAt: Date.now() + 300000,
    confirmationPhrase: "FORCE DELETE LEGACY TRUST",
    files: [
      { name: "trust_store.json", bytes: 42, sha256: "a".repeat(64) },
      { name: "trust_store.json.bak", bytes: 17, sha256: "b".repeat(64) },
    ],
  };
  forceResult = {
    completed: true,
    removedFiles: ["trust_store.json", "trust_store.json.bak"],
    preservedFiles: ["trust_store.json", "trust_store.json.bak"],
    recoveryPath: "F:\\isolated-fixture\\legacy-trust-recovery\\review",
    errors: [],
  };
  saveDialog.mockClear();
  openDialog.mockClear();
  writeTextFile.mockClear();
  readTextFile.mockClear();

  invokeMock = vi.fn(async (command: string) => {
    switch (command) {
      case "trust_legacy_status":
        return legacyStatus;
      case "trust_export_database":
        return trustDocument;
      case "trust_import_database":
        return { imported: 4, skipped: 1 };
      case "trust_import_known_hosts":
        return { imported: 7 };
      case "trust_delete_legacy_stores":
        return 2;
      case "trust_preview_force_delete_legacy":
        return forcePreview;
      case "trust_force_delete_legacy":
        return forceResult;
      case "trust_cancel_force_delete_legacy":
        return true;
      default:
        return null;
    }
  });
});

describe("Legacy Trust — explicit force cleanup", () => {
  it("places force cleanup after normal delete and keeps warnings and inventory inside its confirmation popup", async () => {
    legacyStatus = { ...legacyStatus, legacyPresent: true };
    renderSection();
    await settle();
    const normal = screen.getByTestId("trust-delete-legacy");
    const force = screen.getByRole("button", {
      name: "Force delete legacy trust files…",
    });
    expect(
      normal.compareDocumentPosition(force) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("dialog", { name: "Force delete legacy trust files" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Force cleanup is separate from verified migration/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /FORCE DELETE LEGACY TRUST/ }),
    ).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_preview_force_delete_legacy",
    );
    await review();
    const dialog = screen.getByRole("dialog", {
      name: "Force delete legacy trust files",
    });
    expect(dialog).toContainElement(
      screen.getByText(/Force cleanup is separate from verified migration/),
    );
    expect(dialog).toContainElement(
      screen.getByRole("group", { name: "Review force deletion" }),
    );
    expect(dialog).toContainElement(
      screen.getByRole("textbox", { name: /FORCE DELETE LEGACY TRUST/ }),
    );
    const body = dialog.querySelector(".sor-modal-body");
    const footer = dialog.querySelector(".sor-modal-footer");
    expect(body).toHaveClass("overflow-y-auto", "min-h-0");
    expect(body).toContainElement(
      screen.getByRole("group", { name: "Review force deletion" }),
    );
    expect(footer).toHaveClass("shrink-0");
    expect(footer).toContainElement(
      screen.getByRole("button", { name: "Cancel force deletion" }),
    );
    expect(footer).toContainElement(
      screen.getByRole("button", {
        name: "Preserve recovery copy and force delete",
      }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "trust_cancel_force_delete_legacy",
        { token: forceToken },
      ),
    );
    expect(
      screen.queryByRole("dialog", { name: "Force delete legacy trust files" }),
    ).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_force_delete_legacy",
      expect.anything(),
    );
    expect(
      screen.queryByText(/Force cleanup is separate from verified migration/),
    ).not.toBeInTheDocument();
  });
  async function review() {
    fireEvent.click(
      screen.getByRole("button", { name: "Force delete legacy trust files…" }),
    );
    await screen.findByRole("group", { name: "Review force deletion" });
  }
  function confirm() {
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Type FORCE DELETE LEGACY TRUST to confirm",
      }),
      { target: { value: "FORCE DELETE LEGACY TRUST" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Preserve recovery copy and force delete",
      }),
    );
  }
  it("keeps the dialog open and prevents cancellation once confirmed native cleanup has started", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const original = invokeMock.getMockImplementation() as (
      command: string,
      ...args: unknown[]
    ) => Promise<unknown>;
    invokeMock.mockImplementation((command: string, ...args: unknown[]) =>
      command === "trust_force_delete_legacy"
        ? pending
        : original(command, ...args),
    );
    renderSection();
    await settle();
    await review();
    confirm();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "trust_force_delete_legacy",
        expect.anything(),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Cancel force deletion" }),
    ).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.getByRole("dialog", { name: "Force delete legacy trust files" }),
    ).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_cancel_force_delete_legacy",
      expect.anything(),
    );
    resolve(forceResult);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Force delete legacy trust files",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "Reviewed legacy files removed; verified recovery copies retained.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /FORCE DELETE LEGACY TRUST/ }),
    ).not.toBeInTheDocument();
  });
  it("requires the exact phrase, bypasses incomplete migration only explicitly, and reports recovery", async () => {
    legacyStatus = {
      ...legacyStatus,
      legacyPresent: true,
      canDeleteLegacy: false,
      pendingDatabaseIds: ["db-1"],
      allDatabasesOpened: false,
    };
    renderSection();
    await settle();
    await review();
    const button = screen.getByRole("button", {
      name: "Preserve recovery copy and force delete",
    });
    expect(button).toBeDisabled();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Type FORCE DELETE LEGACY TRUST to confirm",
      }),
      { target: { value: "force delete legacy trust" } },
    );
    expect(button).toBeDisabled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_force_delete_legacy",
      expect.anything(),
    );
    confirm();
    await screen.findByText(
      "Reviewed legacy files removed; verified recovery copies retained.",
    );
    expect(invokeMock).toHaveBeenCalledWith("trust_force_delete_legacy", {
      token: forceToken,
      confirmation: "FORCE DELETE LEGACY TRUST",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("trust_delete_legacy_stores");
    expect(selectDatabase).not.toHaveBeenCalled();
    expect(screen.getByText(/Recovery location:/)).toHaveTextContent(
      String(forceResult.recoveryPath),
    );
    expect(
      screen.getByText(/Recovery copies retain the original format/),
    ).toHaveTextContent(
      "may contain unencrypted trust metadata; this is not secure erasure",
    );
  });
  it("cancels a review without deleting anything", async () => {
    renderSection();
    await settle();
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel force deletion" }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "trust_cancel_force_delete_legacy",
        { token: forceToken },
      ),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_force_delete_legacy",
      expect.anything(),
    );
    expect(
      screen.queryByRole("group", { name: "Review force deletion" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Force delete legacy trust files…" }),
    ).toBeEnabled();
  });
  it("reports partial removal and preserved copies without claiming completion", async () => {
    forceResult = {
      ...forceResult,
      completed: false,
      removedFiles: ["trust_store.json"],
      errors: [
        "Backup sibling removal failed. Remaining sources were not removed.",
      ],
    };
    renderSection();
    await settle();
    await review();
    confirm();
    await screen.findByText(
      "Force cleanup did not complete. Review the exact outcome before retrying.",
    );
    expect(
      screen.getByText("Removed files: trust_store.json."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Verified copies: trust_store.json, trust_store.json.bak.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Reviewed legacy files removed; verified recovery copies retained.",
      ),
    ).not.toBeInTheDocument();
  });
  it("shows preservation failure with zero removals and no success", async () => {
    forceResult = {
      ...forceResult,
      completed: false,
      removedFiles: [],
      preservedFiles: [],
      errors: [
        "Could not durably preserve recovery copy. No legacy files were removed.",
      ],
    };
    renderSection();
    await settle();
    await review();
    confirm();
    await screen.findByText("Removed files: none.");
    expect(
      screen.getByText(/Could not durably preserve recovery copy/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Reviewed legacy files removed; verified recovery copies retained.",
      ),
    ).not.toBeInTheDocument();
  });
  it("rejects drift without false success and refreshes safe status", async () => {
    const original = invokeMock.getMockImplementation() as (
      command: string,
      ...args: unknown[]
    ) => Promise<unknown>;
    invokeMock.mockImplementation((command: string, ...args: unknown[]) =>
      command === "trust_force_delete_legacy"
        ? Promise.reject(
            new Error(
              "Legacy inventory changed after review; no files were removed",
            ),
          )
        : original(command, ...args),
    );
    renderSection();
    await settle();
    await review();
    confirm();
    await screen.findByText(
      "Legacy inventory changed after review; no files were removed",
    );
    expect(
      screen.queryByText(
        "Reviewed legacy files removed; verified recovery copies retained.",
      ),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(
          ([command]) => command === "trust_legacy_status",
        ).length,
      ).toBeGreaterThan(1),
    );
  });
  it("cancels late previews after unmount and never applies", async () => {
    let resolve!: (value: unknown) => void;
    const deferred = new Promise((done) => {
      resolve = done;
    });
    const original = invokeMock.getMockImplementation() as (
      command: string,
      ...args: unknown[]
    ) => Promise<unknown>;
    invokeMock.mockImplementation((command: string, ...args: unknown[]) =>
      command === "trust_preview_force_delete_legacy"
        ? deferred
        : original(command, ...args),
    );
    const view = renderSection();
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: "Force delete legacy trust files…" }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "trust_preview_force_delete_legacy",
      ),
    );
    view.unmount();
    resolve(forcePreview);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "trust_cancel_force_delete_legacy",
        { token: forceToken },
      ),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_force_delete_legacy",
      expect.anything(),
    );
  });
  it("disarms malformed review tokens without exposing a destructive button", async () => {
    forcePreview = {
      ...forcePreview,
      files: [
        {
          name: "databases/current.trust.json",
          bytes: 1,
          sha256: "a".repeat(64),
        },
      ],
    };
    renderSection();
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: "Force delete legacy trust files…" }),
    );
    await screen.findByText(
      "Native force-delete review was invalid. No files were removed.",
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "trust_cancel_force_delete_legacy",
        { token: forceToken },
      ),
    );
    expect(
      screen.queryByRole("button", {
        name: "Preserve recovery copy and force delete",
      }),
    ).not.toBeInTheDocument();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Trust Center — database banner", () => {
  it("names the active database and reports it as encrypted", async () => {
    renderSection();
    await settle();

    const banner = screen.getByTestId("trust-database-banner");
    expect(banner.getAttribute("data-scope-state")).toBe("active");
    expect(screen.getByTestId("trust-database-name")).toHaveTextContent(
      "Production",
    );
    expect(
      screen
        .getByTestId("trust-database-encryption")
        .getAttribute("data-encrypted"),
    ).toBe("true");
    expect(screen.getByTestId("trust-database-encryption")).toHaveTextContent(
      "Encrypted",
    );
  });

  it("reports a plaintext store and the count of migrated records", async () => {
    scope = { ...scope, encrypted: false, seededRecords: 5 };
    renderSection();
    await settle();

    expect(screen.getByTestId("trust-database-encryption")).toHaveTextContent(
      "Plaintext",
    );
    expect(screen.getByTestId("trust-database-seeded")).toHaveTextContent("5");
  });

  it("warns when no database is open and routes management to the empty-state tab", async () => {
    scope = { ...scope, databaseId: null, resolved: true };
    currentDatabase = null;
    renderSection();
    await settle();

    expect(
      screen
        .getByTestId("trust-database-banner")
        .getAttribute("data-scope-state"),
    ).toBe("none");
    expect(screen.getByText("No database is open")).toBeInTheDocument();
    expect(screen.queryByTestId("trust-export-json")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trust-import-json")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open dedicated Trust Center" }),
    );
    expect(openTrustCenter).toHaveBeenCalledOnce();
  });

  // An unanswered `trust_get_active_database` must not claim a lock-out: the
  // store still behaves exactly as it did before t62 (see t62-e6 §1).
  it("stays neutral while the scope is unresolved", async () => {
    scope = { ...scope, databaseId: null, resolved: false };
    renderSection();
    await settle();

    expect(
      screen
        .getByTestId("trust-database-banner")
        .getAttribute("data-scope-state"),
    ).toBe("unresolved");
    expect(
      screen.getByRole("button", { name: "Open dedicated Trust Center" }),
    ).toBeEnabled();
  });

  // The de-DE bundle is loaded and activated for real, so this fails if the
  // `trustCenter.*` keys are missing from a locale file or lose their
  // {{name}} interpolation — the two ways the merge could silently regress.
  it("renders the section in German from the real de-DE bundle", async () => {
    await loadLanguage("de-DE");
    await i18n.changeLanguage("de-DE");
    renderSection();
    await settle();

    expect(screen.getByTestId("trust-database-name")).toHaveTextContent(
      "Gespeichert in der Datenbank „Production“",
    );
    expect(screen.getByTestId("trust-database-encryption")).toHaveTextContent(
      "Verschlüsselt",
    );
    expect(
      screen.getByRole("button", { name: /JSON exportieren/ }),
    ).toHaveTextContent("JSON exportieren");
    expect(
      screen.getByRole("button", { name: /Aus known_hosts importieren/ }),
    ).toHaveTextContent("Aus known_hosts importieren");
  });
});

describe("Trust Center — management moved to its dedicated tab", () => {
  it("keeps search destinations as launchers and never runs the old unreviewed import/export paths", async () => {
    renderSection();
    await settle();
    for (const name of [
      "Open dedicated Trust Center",
      "Export JSON → Trust Center",
      "Import JSON → Trust Center",
      "Import from known_hosts → Trust Center",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(openTrustCenter).toHaveBeenCalledTimes(4);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_import_database",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_import_known_hosts",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_export_database",
      expect.anything(),
    );
    expect(screen.queryByText(/Stored Identities [(]/)).not.toBeInTheDocument();
    expect(saveDialog).not.toHaveBeenCalled();
    expect(openDialog).not.toHaveBeenCalled();
  });
});

describe("Trust Center — legacy sidecars", () => {
  function pendingLegacy() {
    legacyStatus = {
      legacyPresent: true,
      legacyRecords: 3,
      rdpLegacyPresent: false,
      rdpLegacyRecords: 0,
      allDatabasesOpened: false,
      canDeleteLegacy: false,
      pendingDatabaseIds: databaseRows.map((row) => row.id),
      verifiedDatabaseIds: [],
      blockers: [],
    };
  }
  async function review() {
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Review legacy trust migration",
      }),
    );
    await screen.findByRole("region", {
      name: "Legacy trust migration review",
    });
  }
  it("reviews missing-only migration and requires confirmation without opening any database", async () => {
    pendingLegacy();
    await review();
    expect(migrateDatabase).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Migrate 1 ready databases" }),
    );
    expect(
      screen.getByText(/Previously forgotten identities remain excluded/),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(migrateDatabase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-yes"));
    await screen.findByText(/2 added; 1 preserved/);
    expect(migrateDatabase).toHaveBeenCalledWith("db-1");
    expect(selectDatabase).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith("trust_delete_legacy_stores");
    expect(screen.getByTestId("trust-delete-legacy")).toBeDisabled();
  });
  it("requires explicit unlock of a locked legacy source without switching databases", async () => {
    databaseRows[0].isEncrypted = true;
    pendingLegacy();
    await review();
    expect(unlockDatabase).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Migrate 0 ready databases" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Unlock Production" }));
    fireEvent.change(
      await screen.findByLabelText("Database password for migration"),
      { target: { value: "fixture-password" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock for migration" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Migrate 1 ready databases" }),
      ).toBeEnabled(),
    );
    expect(unlockDatabase).toHaveBeenCalledWith("db-1", "fixture-password");
    expect(selectDatabase).not.toHaveBeenCalled();
    expect(migrateDatabase).not.toHaveBeenCalled();
  });
  it("retains per-database partial errors and never deletes sources", async () => {
    databaseRows.push({ ...databaseRows[0], id: "db-2", name: "Staging" });
    pendingLegacy();
    migrateDatabase.mockRejectedValueOnce(new Error("source changed"));
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Migrate 2 ready databases" }),
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    await screen.findByText("source changed");
    await screen.findByText(/2 added; 1 preserved/);
    expect(migrateDatabase).toHaveBeenCalledTimes(2);
    expect(invokeMock).not.toHaveBeenCalledWith("trust_delete_legacy_stores");
  });
  it("cancels between databases while preserving the committed first migration", async () => {
    databaseRows.push({ ...databaseRows[0], id: "db-2", name: "Staging" });
    pendingLegacy();
    let finish!: (value: unknown) => void;
    migrateDatabase.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Migrate 2 ready databases" }),
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    await waitFor(() => expect(migrateDatabase).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel after current database" }),
    );
    finish({
      databaseId: "db-1",
      status: "migrated",
      migratedRecords: 2,
      preservedRecords: 1,
      warnings: [],
    });
    await screen.findByText("Not started; legacy sources retained.");
    expect(migrateDatabase).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("trust_delete_legacy_stores");
  });
  it("reports inspection failure with an explicit retry and disabled cleanup", async () => {
    pendingLegacy();
    const original = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementationOnce(async () => {
      throw new Error("legacy file unreadable");
    });
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "legacy file unreadable",
    );
    expect(screen.getByTestId("trust-delete-legacy")).toBeDisabled();
    invokeMock.mockImplementation(original);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry legacy trust inspection" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("legacy file unreadable"),
      ).not.toBeInTheDocument(),
    );
  });
  it("bounds large reviews to 100 rows while migrating all reviewed ready targets", async () => {
    databaseRows = Array.from({ length: 205 }, (_, index) => ({
      ...databaseRows[0],
      id: `db-${index}`,
      name: `Database ${index}`,
    }));
    pendingLegacy();
    await review();
    expect(screen.getAllByRole("row")).toHaveLength(101);
    expect(
      screen.getByRole("button", { name: "Migrate 205 ready databases" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("row")).toHaveLength(101);
    expect(migrateDatabase).not.toHaveBeenCalled();
  });
  it("hides the legacy card when no legacy file remains", async () => {
    legacyStatus = {
      legacyPresent: false,
      legacyRecords: 0,
      rdpLegacyPresent: false,
      rdpLegacyRecords: 0,
      allDatabasesOpened: true,
    };
    renderSection();
    await settle();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("trust_legacy_status"),
    );
    expect(screen.queryByTestId("trust-legacy")).toBeNull();
  });

  it("blocks deletion until native migration coverage is verified", async () => {
    legacyStatus = {
      legacyPresent: true,
      legacyRecords: 12,
      rdpLegacyPresent: true,
      rdpLegacyRecords: 3,
      allDatabasesOpened: false,
    };
    renderSection();
    await settle();

    const status = await screen.findByTestId("trust-legacy-status");
    expect(status).toHaveTextContent("trust_store.json");
    expect(status).toHaveTextContent("12");
    expect(status).toHaveTextContent("rdp-cert-trust.json");
    expect(status).toHaveTextContent("3");

    expect(screen.getByTestId("trust-delete-legacy")).toBeDisabled();
    expect(
      screen.getByTestId("trust-delete-legacy-blocked"),
    ).toBeInTheDocument();
  });

  it("deletes the legacy files only after the confirm step", async () => {
    legacyStatus = {
      legacyPresent: true,
      legacyRecords: 12,
      rdpLegacyPresent: false,
      rdpLegacyRecords: 0,
      allDatabasesOpened: true,
      canDeleteLegacy: true,
    };
    renderSection();
    await settle();

    fireEvent.click(await screen.findByTestId("trust-delete-legacy"));
    expect(invokeMock).not.toHaveBeenCalledWith("trust_delete_legacy_stores");

    // Backing out leaves the files alone.
    fireEvent.click(screen.getByTestId("trust-delete-legacy-cancel"));
    expect(invokeMock).not.toHaveBeenCalledWith("trust_delete_legacy_stores");

    fireEvent.click(screen.getByTestId("trust-delete-legacy"));
    fireEvent.click(screen.getByTestId("trust-delete-legacy-accept"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("trust_delete_legacy_stores"),
    );
    const message = await screen.findByTestId("trust-action-message");
    expect(message).toHaveAttribute("data-tone", "success");
    expect(message).toHaveTextContent("2");
  });
});
