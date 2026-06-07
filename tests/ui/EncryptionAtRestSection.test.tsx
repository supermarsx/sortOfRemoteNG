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
 *   - the recordings-migration progress bar appears as progress
 *     events come in, and the Cancel button fires `rec_cancel_migration`
 *     + flips the "Cancelling…" badge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import EncryptionAtRestSection from "../../src/components/SettingsDialog/sections/security/EncryptionAtRestSection";
import type { EncryptionStatus } from "../../src/types/encryption/encryption";
import type {
  FullRotateReport,
  RecordingMigrationReport,
  RecordingMigrationProgressEvent,
} from "../../src/hooks/settings/useEncryption";

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
      throw e;
    }
  });
}

let invokeImpl = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: any) => invokeImpl(cmd, args),
  isTauri: () => true,
}));

// Shared in-memory pubsub the hook subscribes to. The recordings
// migration progress events are dispatched into this map by the
// `emit` helper below.
const eventSubscribers: Map<string, Set<(e: { payload: unknown }) => void>> =
  new Map();
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    name: string,
    cb: (e: { payload: unknown }) => void,
  ) => {
    const set = eventSubscribers.get(name) ?? new Set();
    set.add(cb);
    eventSubscribers.set(name, set);
    return () => {
      set.delete(cb);
    };
  },
}));

function emit(name: string, payload: unknown) {
  const set = eventSubscribers.get(name);
  if (!set) return;
  set.forEach((cb) => cb({ payload }));
}

async function waitForSubscribers(name: string, count: number) {
  await waitFor(
    () => {
      expect(eventSubscribers.get(name)?.size ?? 0).toBeGreaterThanOrEqual(
        count,
      );
    },
    { timeout: 3000, interval: 25 },
  );
}

beforeEach(() => {
  invokeImpl = vi.fn();
  eventSubscribers.clear();
});

// ── Tests ─────────────────────────────────────────────────────────

describe("EncryptionAtRestSection", () => {
  it("renders the section header in the common unlocked + vault state", async () => {
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return unlockedVaultStatus;
      throw new Error(`unexpected ${cmd}`);
    });
    render(<EncryptionAtRestSection />);
    // The status card transitions from "Probing…" to the populated
    // grid once the mount fetch resolves. Wait for that.
    await waitFor(() => {
      expect(screen.getAllByText(/Encryption at rest/i).length).toBeGreaterThan(
        0,
      );
    });
    // The mount fetch should also have surfaced the vault backend
    // line, which confirms `status` is populated (not stuck loading).
    expect(
      screen.getByText("Windows Credential Manager + DPAPI"),
    ).toBeTruthy();
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

  it("Migrate-recordings shows live progress and cancels via rec_cancel_migration", async () => {
    // The card is gated on `settingsPlaintextPresent && unlocked` —
    // use the legacy-settings variant so the recordings card mounts.

    // Hold the migration Promise open so the progress UI stays
    // mounted long enough for the test to interact with it.
    let resolveMigration!: (r: RecordingMigrationReport) => void;
    const migrationPromise = new Promise<RecordingMigrationReport>(
      (resolve) => {
        resolveMigration = resolve;
      },
    );
    let cancelCalled = false;

    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return unlockedWithLegacySettings;
      if (cmd === "rec_migrate_to_encrypted") return migrationPromise;
      if (cmd === "rec_cancel_migration") {
        cancelCalled = true;
        return undefined;
      }
      throw new Error(`unexpected ${cmd}`);
    });
    render(<EncryptionAtRestSection />);
    // Wait for the recordings button to mount (status must be loaded
    // AND `settingsPlaintextPresent` honoured by the gate).
    const migrateBtn = await screen.findByRole("button", {
      name: /Migrate recordings \+ macros/,
    });

    fireEvent.click(migrateBtn);

    // The hook subscribes to the progress event BEFORE invoking the
    // command. Wait for that subscription to land, then push events.
    await waitForSubscribers("recording-migrate-progress", 1);

    // Fire the opening event of the envelopes stage (index 0 carries
    // the total but no per-file step yet), then a step event.
    const openingEvent: RecordingMigrationProgressEvent = {
      stage: "envelopes",
      index: 0,
      total: 5,
      name: "",
      skipped: false,
    };
    const stepEvent: RecordingMigrationProgressEvent = {
      stage: "envelopes",
      index: 2,
      total: 5,
      name: "abc.json",
      skipped: false,
    };

    emit("recording-migrate-progress", openingEvent);
    emit("recording-migrate-progress", stepEvent);

    // The progress bar appears with the current index/total.
    const progress = await screen.findByTestId("rec-migration-progress");
    expect(progress.textContent).toMatch(/2\/5/);
    expect(progress.textContent).toMatch(/envelopes/);

    // The cancel button only appears while the migration is busy.
    const cancelBtn = screen.getByTestId("rec-migration-cancel");
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(cancelCalled).toBe(true);
    });

    // "Cancelling…" badge replaces nothing — it's an additional
    // text node next to the progress label. The component flips
    // `migrateRecCancelling` on cancel-button click; the badge is
    // visible while the migration Promise is still pending.
    await waitFor(() => {
      expect(screen.getByText(/Cancelling/)).toBeTruthy();
    });

    // Let the in-flight migration settle so React doesn't warn about
    // act() on an unmount-during-pending-state.
    resolveMigration({
      envelopesMigrated: 5,
      envelopesSkipped: 0,
      macrosMigrated: 0,
      macrosSkipped: 0,
    });
    await waitFor(() => {
      expect(screen.queryByTestId("rec-migration-progress")).toBeNull();
    });
  });
});
