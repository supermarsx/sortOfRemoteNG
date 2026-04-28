import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openImportExport } from '../../helpers/app';

const fixturesDir = fileURLToPath(new URL('../../helpers/fixtures', import.meta.url));

function getFixtureMimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();

  switch (extension) {
    case '.xml':
      return 'application/xml';
    case '.csv':
      return 'text/csv';
    case '.reg':
      return 'text/plain';
    case '.json':
    default:
      return 'application/json';
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

  const content = readFileSync(path.resolve(fixturesDir, filename), 'utf8');

  await browser.execute(
    (selector: string, fileName: string, fileContent: string, mimeType: string) => {
      const input = document.querySelector(selector) as HTMLInputElement | null;
      if (!input) {
        throw new Error(`Input not found for selector: ${selector}`);
      }

      const file = new File([new Blob([fileContent], { type: mimeType })], fileName, {
        type: mimeType,
      });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      Object.defineProperty(input, 'files', {
        value: dataTransfer.files,
        configurable: true,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));
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
    async () => !(await $(S.importExportDialog).isDisplayed().catch(() => false)),
    {
      timeout: 10_000,
      timeoutMsg: 'Expected import/export dialog to close after confirming import',
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

async function waitForGroupName(name: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      (await $(`//div[@data-testid="connection-group"]//span[normalize-space()="${name}"]`)
        .isExisting()
        .catch(() => false)) === true,
    {
      timeout: 10_000,
      timeoutMsg: `Expected group item "${name}" to appear`,
    },
  );
}

async function findVisibleEditor(): Promise<WebdriverIO.Element> {
  const editors = await $$(S.editorPanel);

  for (const editor of editors) {
    if (await editor.isDisplayed().catch(() => false)) {
      return editor;
    }
  }

  throw new Error('Visible connection editor not found');
}

async function findVisibleEditorByName(name: string): Promise<WebdriverIO.Element> {
  const editors = await $$(S.editorPanel);

  for (const editor of editors) {
    if (!(await editor.isDisplayed().catch(() => false))) {
      continue;
    }

    const nameInput = await editor.$(S.editorName);
    if (!(await nameInput.isExisting().catch(() => false))) {
      continue;
    }

    if ((await nameInput.getValue().catch(() => '')) === name) {
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

async function openConnectionEditor(name: string): Promise<WebdriverIO.Element> {
  const item = await findConnectionItem(name);
  await item.scrollIntoView();
  await item.moveTo();

  const rowButtons = await item.$$('button');
  const menuButton = rowButtons.at(-1);
  if (!menuButton) {
    throw new Error(`Connection actions button not found for "${name}"`);
  }

  await menuButton.waitForClickable({ timeout: 5_000 });
  await menuButton.click();

  const menu = await $('[data-testid="connection-tree-item-menu"]');
  await menu.waitForDisplayed({ timeout: 5_000 });

  let editButton: WebdriverIO.Element | undefined;
  for (const button of await menu.$$('button')) {
    if ((await button.getText()).trim() === 'Edit') {
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

async function findVisibleEditorField(
  editor: WebdriverIO.Element,
  selector: string,
): Promise<WebdriverIO.Element> {
  for (const field of await editor.$$(selector)) {
    if (await field.isDisplayed().catch(() => false)) {
      return field;
    }
  }

  for (const field of await $$(selector)) {
    if (await field.isDisplayed().catch(() => false)) {
      return field;
    }
  }

  throw new Error(`Visible editor field not found for selector: ${selector}`);
}

describe('Import Connections', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Import Test');
    await (await $(S.connectionTree)).waitForDisplayed({ timeout: 10_000 });
  });

  it('imports mRemoteNG XML with folders and nested connections', async () => {
    await importFixture('mremoteng-export.xml');

    const previewText = await (await $(S.importPreview)).getText();
    expect(previewText).toContain('Import Successful');
    expect(previewText).toContain('Found 8 connections ready to import.');

    await confirmImport();

    await waitForGroupName('Production Servers');
    await waitForConnectionName('Windows DC');
    await waitForConnectionName('Standalone VNC');

    const editor = await openConnectionEditor('Windows DC');
    expect(await (await editor.$(S.editorHostname)).getValue()).toBe('dc01.prod.example.com');
    expect(await (await findVisibleEditorField(editor, S.editorUsername)).getValue()).toBe('Administrator');
    expect(await (await editor.$(S.editorPort)).getValue()).toBe('3389');
  });

  it('imports CSV connections with host and credential fields intact', async () => {
    await importFixture('csv-connections.csv');

    const previewText = await (await $(S.importPreview)).getText();
    expect(previewText).toContain('Found 5 connections ready to import.');

    await confirmImport();

    await waitForConnectionName('RDP Workstation');

    const editor = await openConnectionEditor('RDP Workstation');
    expect(await (await editor.$(S.editorHostname)).getValue()).toBe('win-ws01.example.com');
    expect(await (await findVisibleEditorField(editor, S.editorUsername)).getValue()).toBe('john.doe');
    expect(await (await editor.$(S.editorPort)).getValue()).toBe('3389');
  });

  it('imports generic JSON exports and opens the imported editor state', async () => {
    await importFixture('connections.json');

    const previewText = await (await $(S.importPreview)).getText();
    expect(previewText).toContain('Found 5 connections ready to import.');

    await confirmImport();

    await waitForConnectionName('Production SSH');

    const editor = await openConnectionEditor('Production SSH');
    expect(await (await editor.$(S.editorHostname)).getValue()).toBe('prod-server.example.com');
    expect(await (await findVisibleEditorField(editor, S.editorUsername)).getValue()).toBe('admin');
    expect(await (await editor.$(S.editorPort)).getValue()).toBe('22');
  });

  it('imports PuTTY registry exports and preserves non-SSH port mapping', async () => {
    await importFixture('putty-export.reg');

    const previewText = await (await $(S.importPreview)).getText();
    expect(previewText).toContain('Found 3 connections ready to import.');

    await confirmImport();

    await waitForConnectionName('Legacy Telnet');

    const editor = await openConnectionEditor('Legacy Telnet');
    expect(await (await editor.$(S.editorHostname)).getValue()).toBe('legacy.example.com');
    expect(await (await editor.$(S.editorPort)).getValue()).toBe('23');
    expect(await (await findVisibleEditorField(editor, S.editorUsername)).getValue()).toBe('');
  });
});
