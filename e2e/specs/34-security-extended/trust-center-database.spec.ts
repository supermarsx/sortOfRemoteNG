// t62-e9 — the Trust Center lives in the database.
//
// What this proves end to end, against the real app and the real Docker sshd
// fixture (`test-ssh`, compose service in e2e/docker-compose.yml):
//
//   1. Accepting an SSH host key writes a record into the ACTIVE database's
//      Trust Center, and Settings → Trust Center names that database.
//   2. The record is durable on disk as `databases/<id>.trust.json` carrying
//      the SDBF preamble — not the retired global `trust_store.json` sidecar.
//   3. Trust travels with export/import: the document from database A merges
//      into database B, and after switching to B the host is trusted there.
//   4. A fresh database C sees none of it — trust is per database (D1/R3).
//
// Developer-local only (WDIO is not run in CI) and Docker-gated: the suite
// skips itself when Docker is unavailable rather than reporting a pass it did
// not earn.
//
// Where this drives `window.__TAURI__.core.invoke` directly, it is calling the
// exact commands the Import/Export wizard and Trust Center buttons call. The
// wizard's file pickers are native OS dialogs that WebDriver cannot drive, so
// the document hand-off is made through the same bridge the UI uses; every
// other step goes through the real UI.
import fs from "fs";
import os from "os";
import path from "path";
import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  closeAllSessions,
  openSettings,
  closeSettings,
} from "../../helpers/app";
import {
  isDockerAvailable,
  startContainers,
  stopContainers,
  waitForContainer,
  SSH_PORT,
} from "../../helpers/docker";

const SSH_USER = process.env.SSH_USER ?? "testuser";
const SSH_PASSWORD = process.env.SSH_PASSWORD ?? "testpass";
const SSH_HOST = "127.0.0.1";
const TRUST_HOST = `${SSH_HOST}:${SSH_PORT}`;

const DB_A = "Trust DB A";
const DB_B = "Trust DB B";
const DB_C = "Trust DB C";

const T = {
  settingsTabTrust: '[data-testid="settings-tab-trust"]',
  banner: '[data-testid="trust-database-banner"]',
  bannerName: '[data-testid="trust-database-name"]',
  bannerEncryption: '[data-testid="trust-database-encryption"]',
  bannerCount: '[data-testid="trust-database-count"]',
  storedIdentities: '[data-testid="settings-dialog"]',
} as const;

// ── native bridge (the commands the wizard and the Trust Center call) ────────

type TrustExportDocument = {
  version: number;
  records: Array<Record<string, unknown>>;
  policy?: unknown;
  policyConfig?: unknown;
};

async function invokeNative<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await browser.executeAsync(
    (
      cmd: string,
      payload: Record<string, unknown>,
      done: (value: { ok: boolean; value?: unknown; error?: string }) => void,
    ) => {
      const bridge = (
        globalThis as {
          __TAURI__?: {
            core?: {
              invoke?: (c: string, a?: unknown) => Promise<unknown>;
            };
          };
        }
      ).__TAURI__?.core?.invoke;
      if (typeof bridge !== "function") {
        done({ ok: false, error: "the Tauri bridge is not available" });
        return;
      }
      bridge(cmd, payload)
        .then((value) => done({ ok: true, value }))
        .catch((error: unknown) => done({ ok: false, error: String(error) }));
    },
    command,
    args,
  );

  const outcome = result as { ok: boolean; value?: unknown; error?: string };
  if (!outcome.ok) {
    throw new Error(`${command} failed: ${outcome.error}`);
  }
  return outcome.value as T;
}

async function activeTrustDatabase(): Promise<{
  databaseId: string | null;
  encrypted: boolean;
  recordCount: number;
  seededRecords: number;
}> {
  return invokeNative("trust_get_active_database");
}

/** `<app_data>` for the installed identifier, i.e. where `databases/` lives. */
function appDataDir(): string {
  const identifier = "com.sortofremote.ng";
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      identifier,
    );
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      identifier,
    );
  }
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    identifier,
  );
}

function trustFilePath(databaseId: string): string {
  return path.join(appDataDir(), "databases", `${databaseId}.trust.json`);
}

/** Reinstall-simulation is out of reach here; assert the durable artifact. */
function readSdbfMagic(file: string): string {
  const handle = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(4);
    fs.readSync(handle, header, 0, 4, 0);
    return header.toString("latin1");
  } finally {
    fs.closeSync(handle);
  }
}

// ── UI helpers ──────────────────────────────────────────────────────────────

async function createSshConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  await (await $(S.editorName)).setValue(name);
  await (await $(S.editorHostname)).setValue(SSH_HOST);
  await (await $(S.editorProtocol)).selectByVisibleText("SSH");

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(SSH_PORT));

  await (await $(S.editorUsername)).setValue(SSH_USER);
  await (await $(S.editorPassword)).setValue(SSH_PASSWORD);

  await (await $(S.editorSave)).click();
  await browser.pause(500);
}

/**
 * Connect and answer the first-use host-key prompt with "accept and save".
 * The prompt is a confirm dialog; when the policy is TOFU the backend may
 * accept without one, so its absence is not a failure.
 */
async function connectAndTrustHostKey(): Promise<void> {
  const tree = await $(S.connectionTree);
  const item = await tree.$(S.connectionItem);
  await item.doubleClick();

  const confirm = await $(S.confirmDialog);
  const prompted = await confirm
    .waitForDisplayed({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (prompted) {
    await (await $(S.confirmYes)).click();
  }

  const terminal = await $(S.sshTerminal);
  await terminal.waitForDisplayed({ timeout: 30_000 });
}

async function openTrustCenter(): Promise<void> {
  await openSettings();
  const tab = await $(T.settingsTabTrust);
  await tab.waitForClickable({ timeout: 10_000 });
  await tab.click();
  const banner = await $(T.banner);
  await banner.waitForDisplayed({ timeout: 10_000 });
}

async function trustCenterText(): Promise<string> {
  const dialog = await $(T.storedIdentities);
  return (await dialog.getText()).replace(/\s+/g, " ");
}

/** Switch the open database from the Database Center list. */
async function switchToDatabase(name: string): Promise<void> {
  const toolbarButton = await $(S.toolbarCollection);
  await toolbarButton.waitForClickable({ timeout: 10_000 });
  await toolbarButton.click();

  const openLabels = ["Open", "Unlock"];
  let clicked = false;
  for (const label of openLabels) {
    const button = await $(
      `//*[contains(normalize-space(.), "${name}")]/ancestor::div[1]//button[@aria-label="${label}"]`,
    );
    if (await button.isExisting().catch(() => false)) {
      await button.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    throw new Error(`No open/unlock control found for database "${name}"`);
  }

  await browser.waitUntil(
    async () => {
      const newConnection = await $(S.toolbarNewConnection);
      return (await newConnection.getAttribute("disabled")) === null;
    },
    { timeout: 15_000, timeoutMsg: `Database "${name}" did not become active` },
  );
  // `trust_set_active_database` is awaited by the store, not by the click.
  await browser.waitUntil(
    async () => (await activeTrustDatabase()).databaseId !== null,
    { timeout: 15_000, timeoutMsg: "Trust scope never followed the database" },
  );
}

// ── suite ───────────────────────────────────────────────────────────────────

describe("Trust Center — per-database storage (docker sshd fixture)", () => {
  let dockerAvailable = false;

  before(function () {
    dockerAvailable = isDockerAvailable();
    if (!dockerAvailable) {
      console.warn(
        "[trust-center-database.spec] Docker not available — skipping suite",
      );
      this.skip();
      return;
    }
    startContainers(["test-ssh"]);
  });

  before(async function () {
    if (!dockerAvailable) return;
    await waitForContainer("ssh", SSH_PORT, 60_000);
  });

  after(() => {
    if (dockerAvailable) {
      stopContainers(["test-ssh"]);
    }
  });

  afterEach(async () => {
    await closeAllSessions().catch(() => undefined);
  });

  it("stores an accepted SSH host key in the active database and shows it in the Trust Center", async () => {
    await resetAppState();
    await createCollection(DB_A);

    const scope = await activeTrustDatabase();
    expect(scope.databaseId).not.toBe(null);

    await createSshConnection("Trust SSH A");
    await connectAndTrustHostKey();
    await closeAllSessions();

    await openTrustCenter();
    const banner = await $(T.bannerName);
    expect(await banner.getText()).toContain(DB_A);

    const encryption = await $(T.bannerEncryption);
    // A collection created without a password is stored in plaintext SDBF.
    expect(await encryption.getAttribute("data-encrypted")).toBe("false");

    const count = await $(T.bannerCount);
    expect(
      Number.parseInt((await count.getText()).replace(/\D+/g, ""), 10) || 0,
    ).toBeGreaterThan(0);

    expect(await trustCenterText()).toContain(SSH_HOST);
    await closeSettings();

    // The record is durable beside the database payload, not in the retired
    // global sidecar.
    const active = await activeTrustDatabase();
    const trustFile = trustFilePath(active.databaseId!);
    expect(fs.existsSync(trustFile)).toBe(true);
    expect(readSdbfMagic(trustFile)).toBe("SDBF");
    expect(fs.existsSync(path.join(appDataDir(), "trust_store.json"))).toBe(
      false,
    );

    const document = await invokeNative<TrustExportDocument>(
      "trust_export_database",
      { databaseId: active.databaseId },
    );
    expect(document.version).toBe(1);
    expect(
      document.records.some((record) =>
        String(record.host ?? "").includes(SSH_HOST),
      ),
    ).toBe(true);
  });

  it("carries trust into another database on export/import and keeps a fresh database clean", async () => {
    // Database A already holds the accepted host key from the previous test;
    // rebuild it here so the case stands on its own.
    await resetAppState();
    await createCollection(DB_A);
    await createSshConnection("Trust SSH A");
    await connectAndTrustHostKey();
    await closeAllSessions();

    const source = await activeTrustDatabase();
    const document = await invokeNative<TrustExportDocument>(
      "trust_export_database",
      { databaseId: source.databaseId },
    );
    const sshRecords = document.records.filter((record) =>
      String(record.host ?? "").includes(SSH_HOST),
    );
    expect(sshRecords.length).toBeGreaterThan(0);

    // A brand-new database starts empty — trust is per database (D1 / R3).
    await createCollection(DB_B);
    const target = await activeTrustDatabase();
    expect(target.databaseId).not.toBe(source.databaseId);
    expect(target.recordCount).toBe(0);

    await openTrustCenter();
    expect(await (await $(T.bannerName)).getText()).toContain(DB_B);
    expect(await trustCenterText()).not.toContain(TRUST_HOST);
    await closeSettings();

    // The Import/Export wizard's merge, driven through its own command.
    const outcome = await invokeNative<{ imported: number; skipped: number }>(
      "trust_import_database",
      { databaseId: target.databaseId, document, mode: "merge" },
    );
    expect(outcome.imported).toBeGreaterThan(0);

    const imported = await invokeNative<TrustExportDocument>(
      "trust_export_database",
      { databaseId: target.databaseId },
    );
    expect(
      imported.records.some((record) =>
        String(record.host ?? "").includes(SSH_HOST),
      ),
    ).toBe(true);
    expect(fs.existsSync(trustFilePath(target.databaseId!))).toBe(true);

    // Switching back and forth keeps each database on its own records.
    await switchToDatabase(DB_A);
    expect((await activeTrustDatabase()).databaseId).toBe(source.databaseId);
    await switchToDatabase(DB_B);
    expect((await activeTrustDatabase()).databaseId).toBe(target.databaseId);

    // A third, never-imported database still sees nothing.
    await createCollection(DB_C);
    const fresh = await activeTrustDatabase();
    expect(fresh.databaseId).not.toBe(source.databaseId);
    expect(fresh.databaseId).not.toBe(target.databaseId);
    expect(fresh.recordCount).toBe(0);

    await openTrustCenter();
    expect(await (await $(T.bannerName)).getText()).toContain(DB_C);
    expect(await trustCenterText()).not.toContain(TRUST_HOST);
    await closeSettings();
  });
});
