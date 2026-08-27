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
    getInstance: () => ({ getCurrentDatabase: () => currentDatabase }),
  },
  onCurrentDatabaseChange: () => () => undefined,
}));

vi.mock("../../src/utils/auth/trustStore", () => ({
  getAllTrustRecords: vi.fn(() => []),
  getAllPerConnectionTrustRecords: vi.fn(() => []),
  ensureTrustStoreReady: vi.fn(() => Promise.resolve()),
  retryTrustStoreHydration: vi.fn(() => Promise.resolve()),
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

function renderSection() {
  return render(
    <TrustVerificationSettings settings={settings} updateSettings={vi.fn()} />,
  );
}

/** Wait for the mount-time `trust_legacy_status` round trip to settle. */
async function settle() {
  await waitFor(() => expect(invokeMock).toHaveBeenCalled());
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  scope = {
    databaseId: "db-1",
    encrypted: true,
    recordCount: 3,
    seededRecords: 0,
    resolved: true,
  };
  currentDatabase = { id: "db-1", name: "Production" };
  legacyStatus = null;
  savePath = "/tmp/trust.json";
  openPath = "/tmp/trust.json";
  fileContents = JSON.stringify(trustDocument);
  writtenFiles = [];
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
      default:
        return null;
    }
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

  it("warns and disables every action when no database is open", async () => {
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
    expect(screen.getByTestId("trust-export-json")).toBeDisabled();
    expect(screen.getByTestId("trust-import-json")).toBeDisabled();
    expect(screen.getByTestId("trust-import-known-hosts")).toBeDisabled();
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
    expect(screen.getByTestId("trust-export-json")).not.toBeDisabled();
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
    expect(screen.getByTestId("trust-export-json")).toHaveTextContent(
      "JSON exportieren",
    );
    expect(screen.getByTestId("trust-import-known-hosts")).toHaveTextContent(
      "Aus known_hosts importieren",
    );
  });
});

describe("Trust Center — JSON portability", () => {
  it("exports the active database's document through the save dialog", async () => {
    renderSection();
    await settle();

    fireEvent.click(screen.getByTestId("trust-export-json"));

    await waitFor(() => expect(writtenFiles).toHaveLength(1));
    expect(invokeMock).toHaveBeenCalledWith("trust_export_database", {
      databaseId: "db-1",
    });
    expect(saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: "JSON", extensions: ["json"] }],
      }),
    );
    const [path, contents] = writtenFiles[0];
    expect(path).toBe("/tmp/trust.json");
    expect(JSON.parse(contents)).toEqual(trustDocument);
    expect(screen.getByTestId("trust-action-message")).toHaveAttribute(
      "data-tone",
      "success",
    );
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    savePath = null;
    renderSection();
    await settle();

    fireEvent.click(screen.getByTestId("trust-export-json"));

    await waitFor(() => expect(saveDialog).toHaveBeenCalled());
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId("trust-action-message")).toBeNull();
  });

  it("imports a document as a merge and reports the outcome", async () => {
    renderSection();
    await settle();

    fireEvent.click(screen.getByTestId("trust-import-json"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("trust_import_database", {
        databaseId: "db-1",
        document: trustDocument,
        mode: "merge",
      }),
    );
    const message = await screen.findByTestId("trust-action-message");
    expect(message).toHaveAttribute("data-tone", "success");
    expect(message).toHaveTextContent("4");
    expect(message).toHaveTextContent("1");
  });

  // A user is far more likely to point this at a full database export than at
  // a bare trust document, so the nested form is accepted too.
  it("accepts a full database export that nests the document", async () => {
    fileContents = JSON.stringify({
      connections: [],
      trustRecords: trustDocument,
    });
    renderSection();
    await settle();

    fireEvent.click(screen.getByTestId("trust-import-json"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "trust_import_database",
        expect.objectContaining({ document: trustDocument }),
      ),
    );
  });

  it("rejects a file that is not a Trust Center export", async () => {
    fileContents = JSON.stringify({ hello: "world" });
    renderSection();
    await settle();

    fireEvent.click(screen.getByTestId("trust-import-json"));

    const message = await screen.findByTestId("trust-action-message");
    expect(message).toHaveAttribute("data-tone", "error");
    expect(message).toHaveTextContent("not a Trust Center export");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "trust_import_database",
      expect.anything(),
    );
  });

  it("imports OpenSSH host keys from known_hosts", async () => {
    renderSection();
    await settle();

    fireEvent.click(screen.getByTestId("trust-import-known-hosts"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("trust_import_known_hosts", {}),
    );
    const message = await screen.findByTestId("trust-action-message");
    expect(message).toHaveAttribute("data-tone", "success");
    expect(message).toHaveTextContent("7");
  });
});

describe("Trust Center — legacy sidecars", () => {
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

  it("blocks deletion until every database has been opened once", async () => {
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
