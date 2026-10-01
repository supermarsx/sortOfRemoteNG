import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import {
  CloudSyncPartialApplyError,
  applyCloudSyncPayload,
  captureCloudSyncPayload,
  type CloudSyncPayload,
} from "../../src/utils/services/cloudSyncPayload";
import { nativeManagedScriptsStore } from "../../src/utils/recording/managedScriptPersistence";
import { terminalMacrosStore } from "../../src/utils/recording/terminalMacroPersistence";
import { webAutomationStore } from "../../src/utils/recording/webAutomationLibrary";
import { AppDataJsonStore } from "../../src/utils/storage/appDataJsonStore";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";

// Only the native boundary and unrelated database/settings services are mocked.
// Library load/update, domain sanitizers and ledger reconciliation stay real.
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "review-owner" }),
      getExportableDatabases: async () => [],
    }),
  },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => ({}) }),
  },
}));

const CREATED = "2024-01-02T03:04:05.000Z";
const UPDATED = "2024-02-03T04:05:06.000Z";
const REMOTE_UPDATED = "2025-03-04T05:06:07.000Z";
const dates = { createdAt: CREATED, updatedAt: UPDATED };
const libraries = [
  {
    name: "managed scripts / app-data CAS",
    store: nativeManagedScriptsStore,
    records: "customScripts",
    value: {
      customScripts: [
        {
          id: "script-fixture",
          name: "Host name",
          description: "Fixture",
          script: "hostname",
          language: "bash",
          category: "Test",
          osTags: ["linux"],
          ...dates,
        },
      ],
      modifiedDefaults: [],
      deletedDefaultIds: [],
    },
  },
  {
    name: "terminal macros / macro-library CAS",
    store: terminalMacrosStore,
    records: "macros",
    value: {
      version: 1,
      macros: [
        {
          id: "macro-fixture",
          name: "Host name",
          steps: [{ command: "hostname", delayMs: 0, sendNewline: true }],
          ...dates,
        },
      ],
      legacyDigest: null,
    },
  },
  {
    name: "website automation / macro-library CAS",
    store: webAutomationStore,
    records: "scripts",
    value: {
      version: 1,
      scripts: [
        {
          id: "web-fixture",
          kind: "script",
          name: "Page title",
          description: "Fixture",
          code: "document.title",
          ...dates,
        },
      ],
      macros: [],
    },
  },
];
type Library = (typeof libraries)[number];
type LibraryValue = Record<string, unknown> & { recordMetadata: RecordLedger };

let durable: Map<string, string>;
let failVerificationFor: string | undefined;
let pendingVerificationFailure: string | undefined;
let verificationFailures: number;

const casCalls = () =>
  native.invoke.mock.calls.filter(([command]) =>
    command.startsWith("compare_and_swap_"),
  );
const configFor = (library: Library) => ({
  ...defaultCloudSyncConfig,
  selectedItems: [`app:${library.store.key}`],
  encryptBeforeSync: true,
});
const payloadFor = (
  library: Library,
  value: LibraryValue,
): CloudSyncPayload => ({
  version: 1,
  sections: { [`app:${library.store.key}`]: value },
});

async function captureBaseline(library: Library) {
  expect(library.store).toBeInstanceOf(AppDataJsonStore);
  durable.set(library.store.key, JSON.stringify(library.value));
  const baseline = await captureCloudSyncPayload(configFor(library));
  expect(casCalls()).toHaveLength(1); // Real load performs the legacy migration.
  const value = baseline.sections[`app:${library.store.key}`] as LibraryValue;
  expect(value.recordMetadata.version).toBe(1);
  expect(JSON.parse(durable.get(library.store.key)!)).toEqual(value);
  native.invoke.mockClear(); // Subsequent counts cover only apply, not migration.
  return baseline;
}

function removeRecord(
  library: Library,
  baseline: CloudSyncPayload,
): LibraryValue {
  const remote = structuredClone(
    baseline.sections[`app:${library.store.key}`],
  ) as LibraryValue;
  remote[library.records] = [];
  return remote;
}

async function validRemote(library: Library, baseline: CloudSyncPayload) {
  const remote = removeRecord(library, baseline);
  remote.recordMetadata = await reconcileRecordLedger(
    remote,
    remote.recordMetadata,
    { mode: "write", now: REMOTE_UPDATED },
  );
  return remote;
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  durable = new Map();
  failVerificationFor = undefined;
  pendingVerificationFailure = undefined;
  verificationFailures = 0;
  native.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "read_app_settings") return null;
    if (command === "read_app_data" || command === "read_macro_library") {
      if (pendingVerificationFailure === args.key) {
        pendingVerificationFailure = undefined;
        verificationFailures++;
        throw new Error("Injected native verification read failure");
      }
      return durable.get(args.key) ?? null;
    }
    if (
      command === "compare_and_swap_app_data" ||
      command === "compare_and_swap_macro_library"
    ) {
      if ((durable.get(args.key) ?? null) !== args.expected) return false;
      durable.set(args.key, args.replacement);
      if (failVerificationFor === args.key)
        pendingVerificationFailure = args.key;
      return true;
    }
    throw new Error(`Unexpected native command: ${command}`);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(libraries)("cloud ledger adoption: $name", (library) => {
  it("rejects a structurally valid but mismatched remote ledger before any write", async () => {
    const baseline = await captureBaseline(library);
    const originalBytes = durable.get(library.store.key);
    const remote = removeRecord(library, baseline);
    // The record body changed, but its well-formed ledger still describes the
    // old record. Upgrade must reject it, not synthesize replacement history.
    expect(normalizeRecordLedger(remote.recordMetadata)).toEqual(
      remote.recordMetadata,
    );
    const reviewed = structuredClone(remote);
    const error = await applyCloudSyncPayload(
      payloadFor(library, remote),
      configFor(library),
      baseline,
    ).then(
      () => undefined,
      (failure: unknown) => failure,
    );

    expect
      .soft(casCalls(), "A mismatched ledger must not reach CAS")
      .toHaveLength(0);
    expect.soft(durable.get(library.store.key)).toBe(originalBytes);
    expect(remote).toEqual(reviewed);
    expect(error).toBeInstanceOf(Error);
  });

  it("preserves matching remote history exactly through apply and recapture", async () => {
    const baseline = await captureBaseline(library);
    const remote = await validRemote(library, baseline);
    await applyCloudSyncPayload(
      payloadFor(library, remote),
      configFor(library),
      baseline,
    );

    expect(casCalls()).toHaveLength(1);
    expect(JSON.parse(durable.get(library.store.key)!)).toEqual(remote);
    const recaptured = await captureCloudSyncPayload(configFor(library));
    expect(recaptured).toEqual(payloadFor(library, remote));
    expect(casCalls()).toHaveLength(1); // No normalization drift after adoption.
  });

  it("reports partial when the first artifact CAS commits but its verification read fails, without replay", async () => {
    const baseline = await captureBaseline(library);
    const originalBytes = durable.get(library.store.key);
    const remote = await validRemote(library, baseline);
    failVerificationFor = library.store.key;
    const error = await applyCloudSyncPayload(
      payloadFor(library, remote),
      configFor(library),
      baseline,
    ).then(
      () => undefined,
      (failure: unknown) => failure,
    );

    // Only one artifact is selected. No earlier successful item can mask the
    // missing partial classification by incrementing apply's completed count.
    expect(casCalls()).toHaveLength(1);
    expect(casCalls()[0][1].expected).toBe(originalBytes);
    expect(verificationFailures).toBe(1);
    expect(JSON.parse(durable.get(library.store.key)!)).toEqual(remote);
    expect(error).toBeInstanceOf(CloudSyncPartialApplyError);
    expect(error).toMatchObject({ kind: "partial" });
  });
});
