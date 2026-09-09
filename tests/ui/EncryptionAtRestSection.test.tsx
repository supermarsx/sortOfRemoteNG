/**
 * Component tests for `EncryptionAtRestSection`. The Tauri command
 * surface is mocked at the `@tauri-apps/api/core` boundary (the same
 * idiom `tests/settings/useEncryption.test.ts` uses), so the section
 * exercises the real `useEncryption` hook end-to-end and tests cover:
 *
 *   - the panel renders without crashing in the common "unlocked +
 *     vault-backed" state,
 *   - the user-facing "Rotate master key" button calls the FULL
 *     rotation command, not the legacy settings-only one (a
 *     regression here would silently leave connections / backups /
 *     recordings on the old DEK),
 *   - the per-artifact rewrite report renders with the right counts,
 *   - legacy migration controls are replaced by one artifact policy panel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import EncryptionAtRestSection from "../../src/components/SettingsDialog/sections/security/EncryptionAtRestSection";
import type { EncryptionStatus } from "../../src/types/encryption/encryption";
import type { FullRotateReport } from "../../src/hooks/settings/useEncryption";

// ── Status fixtures ───────────────────────────────────────────────

const unlockedVaultStatus: EncryptionStatus = {
  schemaVersion: 2,
  // "vault" so `passwordModeActive` stays false in the component —
  // that keeps the rotate-password row hidden and the rotate button
  // enabled without typing anything.
  masterKeyStorage: "vault",
  unlocked: true,
  vaultAvailable: true,
  vaultHasMasterDek: true,
  vaultBackend: "Windows Credential Manager + DPAPI",
  artifactLabels: [
    "sorng-v1::connections",
    "sorng-v1::settings",
    "sorng-v1::recordings-meta",
    "sorng-v1::recordings-media",
    "sorng-v1::backups",
    "sorng-v1::logs",
    "sorng-v1::macros",
  ],
  passwordWrapPresent: false,
  settingsEncryptedOnDisk: true,
  settingsPlaintextPresent: false,
};

// Variant used for the recordings-migration card. The card is gated
// on `settingsPlaintextPresent && unlocked`, so we flip the legacy
// settings flag to surface the recordings panel below it.
const unlockedWithLegacySettings: EncryptionStatus = {
  ...unlockedVaultStatus,
  settingsPlaintextPresent: true,
};

const zeroLockout = {
  failedAttempts: 0,
  lastFailureUnixMs: 0,
  remainingCooldownMs: 0,
};

const sampleFullReport: FullRotateReport = {
  settingsRewritten: true,
  connectionsRewritten: true,
  backupsRewritten: 2,
  recordingEnvelopesRewritten: 3,
  mediaSidecarsRewritten: 0,
  macrosRewritten: 0,
  bytesRewritten: 8192,
  vaultUpdated: true,
  dekEncUpdated: false,
  failures: [],
};

// ── Invoke + event mocks ──────────────────────────────────────────

function makeInvoke(impl: (cmd: string, args?: any) => Promise<any>) {
  // Same wrapper shape as useEncryption.test.ts: default the always-
  // fetched commands so individual tests can stay focused on the
  // command they actually care about.
  return vi.fn(async (cmd: string, args?: any) => {
    try {
      return await impl(cmd, args);
    } catch (e) {
      if (cmd === "encryption_lockout_state") return zeroLockout;
      if (cmd === "encryption_audit_read") return [];
      if (cmd === "encryption_get_artifact_status")
        return {
          artifacts: [],
          unlocked: true,
          recoveryRequired: false,
          busy: false,
          warnings: [],
        };
      throw e;
    }
  });
}

let invokeImpl = vi.fn();
const portableDialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => portableDialog);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: any) => invokeImpl(cmd, args),
  isTauri: () => true,
}));

// Shared in-memory pubsub the hook subscribes to. The recordings
// migration progress events are dispatched into this map by the
// `emit` helper below.
const eventSubscribers: Map<
  string,
  Set<(e: { payload: unknown }) => void>
> = new Map();
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
    const set = eventSubscribers.get(name) ?? new Set();
    set.add(cb);
    eventSubscribers.set(name, set);
    return () => {
      set.delete(cb);
    };
  },
}));

beforeEach(() => {
  invokeImpl = vi.fn();
  eventSubscribers.clear();
  portableDialog.open.mockReset();
  portableDialog.save.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────

describe("EncryptionAtRestSection", () => {
  it("grants the selected portable export destination and ignores picker cancellation", async () => {
    invokeImpl = makeInvoke(async (command) => {
      if (command === "encryption_status") return unlockedVaultStatus;
      if (command === "encryption_export_portable_dek") return 128;
      throw new Error(`Unexpected command: ${command}`);
    });
    portableDialog.save
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("/granted/master.dek");
    render(<EncryptionAtRestSection />);
    const choose = await screen.findByRole("button", {
      name: "Choose portable key destination",
    });
    expect(choose).toHaveAttribute("type", "button");
    expect(choose).toBeEnabled();
    expect(choose).toHaveClass("self-end", "w-fit", "max-w-full");
    expect(choose.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(choose);
    await waitFor(() => expect(portableDialog.save).toHaveBeenCalledTimes(1));
    expect(
      invokeImpl.mock.calls.some(
        ([name]) => name === "encryption_export_portable_dek",
      ),
    ).toBe(false);
    fireEvent.click(choose);
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("/granted/master.dek"),
      ).toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByPlaceholderText("Used to wrap the DEK at export time"),
      { target: { value: "export-password" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Export key" }));
    await waitFor(() =>
      expect(invokeImpl).toHaveBeenCalledWith(
        "encryption_export_portable_dek",
        {
          destinationPath: "/granted/master.dek",
          password: "export-password",
          argon2: null,
        },
      ),
    );
  });
  it("renders the section header in the common unlocked + vault state", async () => {
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return unlockedVaultStatus;
      throw new Error(`unexpected ${cmd}`);
    });
    render(<EncryptionAtRestSection />);
    // The status card transitions from "Probing…" to the populated
    // grid once the mount fetch resolves. Wait for that.
    await waitFor(() => {
      expect(
        screen.getAllByText(/Global master-key protection/i).length,
      ).toBeGreaterThan(0);
    });
    // The mount fetch should also have surfaced the vault backend
    // line, which confirms `status` is populated (not stuck loading).
    expect(screen.getByText("Windows Credential Manager + DPAPI")).toBeTruthy();
  });

  it("Rotate button calls encryption_rotate_master_key_full, not the legacy command", async () => {
    // Pinning the wire contract: the user-facing rotate button must
    // hit the full-artifact command so connections / backups /
    // recordings get rewritten under the new DEK. Calling the legacy
    // settings-only command would leave most artifacts on the OLD
    // key, which is the worst kind of silent-bug — the UI would
    // claim success while leaving 90% of the data un-rotated.
    let fullCalled = false;
    let legacyCalled = false;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return unlockedVaultStatus;
      if (cmd === "encryption_rotate_master_key_full") {
        fullCalled = true;
        return sampleFullReport;
      }
      if (cmd === "encryption_rotate_master_key") {
        legacyCalled = true;
        return undefined;
      }
      throw new Error(`unexpected ${cmd}`);
    });
    render(<EncryptionAtRestSection />);
    // Wait for status to populate so the rotate card actually mounts
    // (it's gated on status?.unlocked).
    await waitFor(() => {
      expect(
        screen.getByText("Windows Credential Manager + DPAPI"),
      ).toBeTruthy();
    });

    // Two elements match /Rotate master key/ — the section header and
    // the button. Picking by role narrows to the button.
    const rotateBtn = screen.getByRole("button", {
      name: /Rotate master key/,
    });
    fireEvent.click(rotateBtn);

    await waitFor(() => {
      expect(fullCalled).toBe(true);
    });
    expect(legacyCalled).toBe(false);
  });

  it("Rotate summary renders per-artifact counts from the report", async () => {
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return unlockedVaultStatus;
      if (cmd === "encryption_rotate_master_key_full") return sampleFullReport;
      throw new Error(`unexpected ${cmd}`);
    });
    render(<EncryptionAtRestSection />);
    await waitFor(() => {
      expect(
        screen.getByText("Windows Credential Manager + DPAPI"),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Rotate master key/ }));

    // The summary string is a single concatenation:
    //   "Rewrote settings, connections, 2 backup(s), 3 recording
    //    metadata; vault entry updated"
    // We assert the individual count fragments live in the same DOM
    // node so a future plural/pluralization tweak (e.g. "backups")
    // shows up as a single test failure.
    await waitFor(() => {
      const summary = screen.getByText(/Rewrote/);
      expect(summary.textContent).toContain("settings");
      expect(summary.textContent).toContain("connections");
      expect(summary.textContent).toMatch(/2 backup/);
      expect(summary.textContent).toMatch(/3 recording metadata/);
      expect(summary.textContent).toContain("vault entry updated");
    });
  });

  it("uses one artifact policy panel instead of conflicting legacy migration controls", async () => {
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return unlockedWithLegacySettings;
      throw new Error(`unexpected ${cmd}`);
    });
    render(<EncryptionAtRestSection />);
    await screen.findByText("Artifact protection");
    expect(
      screen.queryByRole("button", {
        name: /Migrate recordings|Migrate plaintext|Disable settings encryption/,
      }),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector(
        '[data-setting-key="encryptionAtRest.migratePlaintext"] [data-setting-key="encryptionAtRest.artifacts"]',
      ),
    ).not.toBeNull();
    expect(
      invokeImpl.mock.calls.some(([command]) =>
        [
          "rec_migrate_to_encrypted",
          "encryption_disable_settings",
          "encryption_migrate_settings",
        ].includes(command),
      ),
    ).toBe(false);
  });

  it("reinspects artifacts exactly once after apply despite the neighboring master-status refresh", async () => {
    const row = {
      id: "settings",
      policy: "default",
      diskState: "plaintext",
      encryptedFiles: 0,
      plaintextFiles: 1,
      unverifiedFiles: 0,
      bytes: 32,
      mutable: true,
    };
    invokeImpl = makeInvoke(async (cmd, args) => {
      // Return a new object on every refresh, as real IPC does.
      if (cmd === "encryption_status") return { ...unlockedVaultStatus };
      if (cmd === "encryption_get_artifact_status")
        return {
          artifacts: [row],
          unlocked: true,
          recoveryRequired: false,
          busy: false,
          warnings: [],
        };
      if (cmd === "encryption_preview_artifact_policy")
        return {
          token: "integration-preview",
          target: "encrypted",
          artifacts: [row],
          totalFiles: 1,
          totalBytes: 32,
        };
      if (cmd === "encryption_apply_artifact_policy")
        return {
          requestId: args.requestId,
          outcome: "completed",
          recoveryRequired: false,
          results: [{ id: "settings", outcome: "committed", files: 1 }],
        };
      if (cmd === "encryption_release_artifact_preview") return;
      throw new Error(`unexpected ${cmd}`);
    });
    render(<EncryptionAtRestSection />);
    await screen.findByText("Windows Credential Manager + DPAPI");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Encrypt all supported" }),
      ).toBeEnabled(),
    );
    const before = invokeImpl.mock.calls.filter(
      ([command]) => command === "encryption_get_artifact_status",
    ).length;
    fireEvent.click(
      screen.getByRole("button", { name: "Encrypt all supported" }),
    );
    fireEvent.click(await screen.findByTestId("confirm-yes"));
    await screen.findByText(/Operation completed/);
    await waitFor(() =>
      expect(
        invokeImpl.mock.calls.filter(
          ([command]) => command === "encryption_status",
        ).length,
      ).toBeGreaterThan(1),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      invokeImpl.mock.calls.filter(
        ([command]) => command === "encryption_get_artifact_status",
      ),
    ).toHaveLength(before + 1);
  });
});
