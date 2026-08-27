import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  openImportExport,
  openSettings,
  closeSettings,
} from "../../helpers/app";

/**
 * t71 — HTTP/HTTPS entries must never be imported, pasted or detected as RDP.
 *
 * Covers: mRemoteNG confCons with `HTTPS` / `Web` / `HTTP` + URL hostname /
 * `InheritProtocol` under an HTTPS container; CSV `Web` / `HTTP/S` rows; the
 * editor and Quick Connect switching protocol from a pasted `https://` URL;
 * and the Settings → Advanced repair dialog fixing a seeded RDP:443 record.
 */

const fixturesDir = fileURLToPath(
  new URL("../../helpers/fixtures", import.meta.url),
);

function getFixtureMimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();

  switch (extension) {
    case ".xml":
      return "application/xml";
    case ".csv":
      return "text/csv";
    case ".json":
    default:
      return "application/json";
  }
}

async function openImportTab(): Promise<void> {
  await openImportExport();

  const importTab = await $(S.importTab);
  await importTab.waitForClickable({ timeout: 5_000 });
  await importTab.click();

  await (await $(S.importFileInput)).waitForExist({ timeout: 10_000 });
}

async function importFixture(filename: string): Promise<void> {
  await openImportTab();

  const content = readFileSync(path.resolve(fixturesDir, filename), "utf8");

  await browser.execute(
    (
      selector: string,
      fileName: string,
      fileContent: string,
      mimeType: string,
    ) => {
      const input = document.querySelector(selector) as HTMLInputElement | null;
      if (!input) {
        throw new Error(`Input not found for selector: ${selector}`);
      }

      const file = new File(
        [new Blob([fileContent], { type: mimeType })],
        fileName,
        {
          type: mimeType,
        },
      );
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      Object.defineProperty(input, "files", {
        value: dataTransfer.files,
        configurable: true,
      });

      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    S.importFileInput,
    filename,
    content,
    getFixtureMimeType(filename),
  );

  await (await $(S.importPreview)).waitForDisplayed({ timeout: 10_000 });
}

async function confirmImport(): Promise<void> {
  const confirmButton = await $(S.importConfirm);
  await confirmButton.waitForClickable({ timeout: 5_000 });
  await confirmButton.click();

  await browser.waitUntil(
    async () =>
      !(await $(S.importExportDialog)
        .isDisplayed()
        .catch(() => false)),
    {
      timeout: 10_000,
      timeoutMsg:
        "Expected import/export dialog to close after confirming import",
    },
  );
}

async function listConnectionNames(): Promise<string[]> {
  const items = await $$(S.connectionItem);
  const names: string[] = [];

  for (const item of items) {
    names.push((await item.getText()).trim());
  }

  return names;
}

async function waitForConnectionName(name: string): Promise<void> {
  await browser.waitUntil(
    async () => (await listConnectionNames()).includes(name),
    {
      timeout: 10_000,
      timeoutMsg: `Expected tree item "${name}" to appear`,
    },
  );
}

async function findVisibleEditorByName(
  name: string,
): Promise<WebdriverIO.Element> {
  const editors = await $$(S.editorPanel);

  for (const editor of editors) {
    if (!(await editor.isDisplayed().catch(() => false))) {
      continue;
    }

    const nameInput = await editor.$(S.editorName);
    if (!(await nameInput.isExisting().catch(() => false))) {
      continue;
    }

    if ((await nameInput.getValue().catch(() => "")) === name) {
      return editor;
    }
  }

  throw new Error(`Visible editor for connection "${name}" not found`);
}

async function findConnectionItem(name: string): Promise<WebdriverIO.Element> {
  const items = await $$(S.connectionItem);

  for (const item of items) {
    if ((await item.getText()).trim() === name) {
      return item;
    }
  }

  throw new Error(`Connection tree item "${name}" not found`);
}

async function openConnectionEditor(
  name: string,
): Promise<WebdriverIO.Element> {
  const item = await findConnectionItem(name);
  await item.scrollIntoView();
  await item.moveTo();

  const rowButtons = await item.$$("button");
  const buttonCount = await rowButtons.length;
  if (buttonCount === 0) {
    throw new Error(`Connection actions button not found for "${name}"`);
  }
  const menuButton = rowButtons[buttonCount - 1];

  await menuButton.waitForClickable({ timeout: 5_000 });
  await menuButton.click();

  const menu = await $('[data-testid="connection-tree-item-menu"]');
  await menu.waitForDisplayed({ timeout: 5_000 });

  let editButton: WebdriverIO.Element | undefined;
  for (const button of await menu.$$("button")) {
    if ((await button.getText()).trim() === "Edit") {
      editButton = button;
      break;
    }
  }

  if (!editButton) {
    throw new Error(`Edit action not found for connection "${name}"`);
  }

  await editButton.click();

  await browser.waitUntil(
    async () => {
      try {
        await findVisibleEditorByName(name);
        return true;
      } catch {
        return false;
      }
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected editor for imported connection "${name}"`,
    },
  );

  return findVisibleEditorByName(name);
}

/**
 * `S.editorProtocol` / `S.quickConnectProtocol` are custom Select triggers whose
 * text is the selected option label (e.g. "HTTPS", "HTTP", "RDP").
 */
async function readSelectLabel(
  trigger: ChainablePromiseElement,
): Promise<string> {
  return (await trigger.getText()).trim().toUpperCase();
}

async function expectEditorProtocol(
  editor: WebdriverIO.Element,
  protocolLabel: "HTTP" | "HTTPS" | "RDP",
  port: string,
  hostname: string,
): Promise<void> {
  const protocolTrigger = await editor.$(S.editorProtocol);
  await browser.waitUntil(
    async () =>
      (await readSelectLabel(protocolTrigger)).includes(protocolLabel),
    {
      timeout: 5_000,
      timeoutMsg: `Expected protocol select to show ${protocolLabel}`,
    },
  );

  const label = await readSelectLabel(protocolTrigger);
  expect(label).toContain(protocolLabel);
  if (protocolLabel === "HTTP") {
    // "HTTP" must not be a substring match against "HTTPS".
    expect(label).not.toContain("HTTPS");
  }
  expect(label).not.toContain("RDP");

  expect(await (await editor.$(S.editorPort)).getValue()).toBe(port);
  expect(await (await editor.$(S.editorHostname)).getValue()).toBe(hostname);
}

async function closeVisibleEditor(): Promise<void> {
  await browser.keys("Escape");
  await browser.pause(200);
}

async function findVisibleEditor(): Promise<WebdriverIO.Element> {
  const editors = await $$(S.editorPanel);

  for (const editor of editors) {
    if (await editor.isDisplayed().catch(() => false)) {
      return editor;
    }
  }

  throw new Error("Visible connection editor not found");
}

async function openNewConnectionEditor(): Promise<WebdriverIO.Element> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.waitForClickable({ timeout: 5_000 });
  await addBtn.click();

  await (await $(S.editorPanel)).waitForDisplayed({ timeout: 5_000 });
  return findVisibleEditor();
}

describe("Import web protocols (HTTP/HTTPS never become RDP)", () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection("Web Protocol Test");
    await (await $(S.connectionTree)).waitForDisplayed({ timeout: 10_000 });
  });

  it("imports mRemoteNG HTTPS/Web/HTTP nodes with the correct protocol and port", async () => {
    await importFixture("mremoteng-https.xml");

    const previewText = await (await $(S.importPreview)).getText();
    expect(previewText).toContain("Import Successful");
    expect(previewText).toContain("Found 5 connections ready to import.");
    expect(previewText).not.toMatch(/\bRDP\b/);

    await confirmImport();

    await waitForConnectionName("Intranet Portal");
    await waitForConnectionName("Proxmox Web");
    await waitForConnectionName("Router Admin");
    await waitForConnectionName("iLO Console");

    // Protocol="HTTPS" Port="443"
    let editor = await openConnectionEditor("Intranet Portal");
    await expectEditorProtocol(editor, "HTTPS", "443", "portal.example.com");
    await closeVisibleEditor();

    // Protocol="Web" Port="8443" → https by port evidence
    editor = await openConnectionEditor("Proxmox Web");
    await expectEditorProtocol(editor, "HTTPS", "8443", "pve.example.com");
    await closeVisibleEditor();

    // Protocol="HTTP" Hostname="http://router.local/admin" → http, scheme stripped
    editor = await openConnectionEditor("Router Admin");
    await expectEditorProtocol(editor, "HTTP", "80", "router.local");
    await closeVisibleEditor();

    // Protocol="RDP" InheritProtocol="true" under an HTTPS container → https
    editor = await openConnectionEditor("iLO Console");
    await expectEditorProtocol(editor, "HTTPS", "443", "ilo.example.com");
    await closeVisibleEditor();
  });

  it('imports CSV "Web" and "HTTP/S" rows as web protocols', async () => {
    await importFixture("csv-web-protocols.csv");

    const previewText = await (await $(S.importPreview)).getText();
    expect(previewText).toContain("Found 3 connections ready to import.");

    await confirmImport();

    await waitForConnectionName("Web Dashboard");
    await waitForConnectionName("Legacy Web App");

    // Web + 443 → https
    let editor = await openConnectionEditor("Web Dashboard");
    await expectEditorProtocol(editor, "HTTPS", "443", "dash.example.com");
    await closeVisibleEditor();

    // HTTP/S + 8080 → http (port evidence)
    editor = await openConnectionEditor("Legacy Web App");
    await expectEditorProtocol(editor, "HTTP", "8080", "legacy.example.com");
    await closeVisibleEditor();
  });

  it("switches a new connection to HTTPS:8443 when a URL is pasted into the hostname", async () => {
    const editor = await openNewConnectionEditor();

    const nameInput = await editor.$(S.editorName);
    await nameInput.setValue("Pasted Portal");

    const hostnameInput = await editor.$(S.editorHostname);
    await hostnameInput.setValue("https://portal.example.com:8443/login");

    // Blur triggers `sanitizeHostnameField` → protocol/port switch.
    await nameInput.click();

    await expectEditorProtocol(editor, "HTTPS", "8443", "portal.example.com");
  });

  it("switches Quick Connect to HTTPS when a URL is pasted into the hostname", async () => {
    const quickConnectBtn = await $(S.toolbarQuickConnect);
    await quickConnectBtn.waitForClickable({ timeout: 5_000 });
    await quickConnectBtn.click();

    const hostnameInput = await $(S.quickConnectHostname);
    await hostnameInput.waitForDisplayed({ timeout: 5_000 });

    const protocolTrigger = await $(S.quickConnectProtocol);
    expect(await readSelectLabel(protocolTrigger)).toContain("RDP");

    await hostnameInput.setValue("https://portal.example.com:8443/login");
    // Blur (Tab away) runs `normalizeHostnameInput`.
    await browser.keys("Tab");

    await browser.waitUntil(
      async () => (await readSelectLabel(protocolTrigger)).includes("HTTPS"),
      {
        timeout: 5_000,
        timeoutMsg: "Expected Quick Connect protocol to switch to HTTPS",
      },
    );
    expect(await readSelectLabel(protocolTrigger)).not.toContain("RDP");

    // Quick Connect has no port field: the explicit URL port stays on the hostname.
    expect(await hostnameInput.getValue()).toBe("portal.example.com:8443");

    await browser.keys("Escape");
  });

  it("repair dialog lists a mis-typed RDP:443 connection and fixes it with one click", async () => {
    // The CSV fixture seeds "Mistyped Jump" with an explicit `rdp` protocol on
    // port 443 — the alias is honoured on import, so it lands as RDP.
    await importFixture("csv-web-protocols.csv");
    await confirmImport();
    await waitForConnectionName("Mistyped Jump");

    let editor = await openConnectionEditor("Mistyped Jump");
    await expectEditorProtocol(editor, "RDP", "443", "jump.example.com");
    await closeVisibleEditor();

    await openSettings();

    const advancedTab = await $(S.settingsTabAdvanced);
    await advancedTab.waitForClickable({ timeout: 5_000 });
    await advancedTab.click();

    const repairOpen = await $(S.protocolRepairOpen);
    await repairOpen.waitForClickable({ timeout: 5_000 });
    expect((await (await $(S.protocolRepairCount)).getText()).trim()).toBe("1");
    await repairOpen.click();

    const dialog = await $(S.protocolRepairDialog);
    await dialog.waitForDisplayed({ timeout: 5_000 });

    const rows = await dialog.$$(S.protocolRepairRow);
    expect(await rows.length).toBe(1);
    const rowText = await rows[0].getText();
    expect(rowText).toContain("Mistyped Jump");
    expect(rowText).toContain("jump.example.com");

    const applyBtn = await dialog.$(S.protocolRepairApply);
    await applyBtn.waitForClickable({ timeout: 5_000 });
    await applyBtn.click();

    await browser.waitUntil(
      async () => !(await dialog.isDisplayed().catch(() => false)),
      {
        timeout: 5_000,
        timeoutMsg: "Expected repair dialog to close after fixing all rows",
      },
    );

    await browser.waitUntil(
      async () =>
        (await (await $(S.protocolRepairCount)).getText()).trim() === "0",
      {
        timeout: 5_000,
        timeoutMsg: "Expected repair count to drop to 0 after the fix",
      },
    );

    await closeSettings();

    editor = await openConnectionEditor("Mistyped Jump");
    await expectEditorProtocol(editor, "HTTPS", "443", "jump.example.com");
  });
});
