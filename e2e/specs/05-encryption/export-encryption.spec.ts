import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openImportExport } from '../../helpers/app';
import { selectCustomOption } from '../../helpers/forms';

const EXPORT_PASSWORD = 'Exp0rt!Encrypt#2026';

interface TestConnection {
  name: string;
  hostname: string;
  protocol: string;
  port: string;
  username: string;
  password: string;
}

interface DownloadCapture {
  filename: string | null;
  text: string | null;
  mimeType: string | null;
  ready: boolean;
  error: string | null;
}

const ROUND_TRIP_CONNECTION: TestConnection = {
  name: 'Encrypted SSH',
  hostname: 'enc.example.com',
  protocol: 'SSH',
  port: '22',
  username: 'vault-admin',
  password: 'VaultPass!42',
};

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

async function findVisibleEditor(): Promise<WebdriverIO.Element> {
  const editors = await $$(S.editorPanel);

  for (const editor of editors) {
    if (await editor.isDisplayed().catch(() => false)) {
      return editor;
    }
  }

  throw new Error('Visible connection editor not found');
}

async function openNewConnectionEditor(): Promise<WebdriverIO.Element> {
  const button = await $(S.toolbarNewConnection);
  await button.waitForClickable({ timeout: 10_000 });
  await button.click();

  await browser.waitUntil(
    async () => {
      try {
        await findVisibleEditor();
        return true;
      } catch {
        return false;
      }
    },
    {
      timeout: 10_000,
      timeoutMsg: 'Expected connection editor to open',
    },
  );

  return findVisibleEditor();
}

async function openConnectionEditor(name: string): Promise<WebdriverIO.Element> {
  const items = await $$(S.connectionItem);
  let matchingItem: WebdriverIO.Element | undefined;

  for (const item of items) {
    if ((await item.getText()).trim() === name) {
      matchingItem = item;
      break;
    }
  }

  if (!matchingItem) {
    throw new Error(`Connection tree item "${name}" not found`);
  }

  await matchingItem.scrollIntoView();
  await matchingItem.moveTo();

  const rowButtons = await matchingItem.$$('button');
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
            return true;
          }
        }

        return false;
      } catch {
        return false;
      }
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected editor for connection "${name}"`,
    },
  );

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

async function selectProtocol(protocol: string): Promise<void> {
  const protocolInput = await $(S.editorProtocol);
  const tagName = await protocolInput.getTagName();

  if (tagName.toLowerCase() === 'select') {
    await protocolInput.selectByVisibleText(protocol);
    return;
  }

  await selectCustomOption(S.editorProtocol, [protocol, protocol.toUpperCase()]);
}

async function addTestConnection(connection: TestConnection): Promise<void> {
  const editor = await openNewConnectionEditor();

  await (await editor.$(S.editorName)).setValue(connection.name);
  await (await editor.$(S.editorHostname)).setValue(connection.hostname);
  await selectProtocol(connection.protocol);

  const portInput = await editor.$(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(connection.port);

  const usernameInput = await findVisibleEditorField(editor, S.editorUsername);
  await usernameInput.waitForDisplayed({ timeout: 5_000 });
  await usernameInput.setValue(connection.username);

  const passwordInput = await findVisibleEditorField(editor, S.editorPassword);
  await passwordInput.waitForDisplayed({ timeout: 5_000 });
  await passwordInput.setValue(connection.password);

  await (await editor.$(S.editorSave)).click();

  await waitForConnectionName(connection.name);
}

async function prepareCollection(name: string): Promise<void> {
  await resetAppState();
  await createCollection(name);
  await (await $(S.connectionTree)).waitForDisplayed({ timeout: 10_000 });
}

async function openExportTab(): Promise<void> {
  await openImportExport();

  const exportTab = await $(S.exportTab);
  await exportTab.waitForClickable({ timeout: 5_000 });
  await exportTab.click();

  await (await $(S.exportConfirm)).waitForDisplayed({ timeout: 10_000 });
}

async function openImportTab(): Promise<void> {
  await openImportExport();

  const importTab = await $(S.importTab);
  await importTab.waitForClickable({ timeout: 5_000 });
  await importTab.click();

  await (await $(S.importFileInput)).waitForExist({ timeout: 10_000 });
}

async function selectExportFormat(label: 'JSON' | 'XML' | 'CSV'): Promise<void> {
  const formatGrid = await $(S.exportFormat);
  const button = await formatGrid.$(
    `./button[.//div[normalize-space()="${label}"] or normalize-space()="${label}"]`,
  );

  await button.waitForClickable({ timeout: 5_000 });
  await button.click();
}

async function setIncludePasswords(enabled: boolean): Promise<void> {
  const checkbox = await $(
    `${S.importExportDialog} input[type="checkbox"]:not([data-testid="export-encrypt"])`,
  );

  await checkbox.waitForExist({ timeout: 5_000 });
  if ((await checkbox.isSelected()) !== enabled) {
    await checkbox.click();
  }
}

async function setEncryptedExport(enabled: boolean, password?: string): Promise<void> {
  const checkbox = await $(S.exportEncrypt);
  await checkbox.waitForExist({ timeout: 5_000 });

  if ((await checkbox.isSelected()) !== enabled) {
    await checkbox.click();
  }

  if (enabled && password) {
    const passwordInput = await $(S.exportPassword);
    await passwordInput.waitForDisplayed({ timeout: 5_000 });
    await passwordInput.clearValue();
    await passwordInput.setValue(password);
  }
}

async function installDownloadCapture(): Promise<void> {
  await browser.execute(() => {
    const win = window as any;

    if (!win.__downloadCaptureInstalled) {
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      const originalCreateElement = document.createElement.bind(document);

      URL.createObjectURL = ((blob: Blob | MediaSource) => {
        const capture = win.__downloadCapture ?? {};
        capture.ready = false;
        capture.error = null;
        capture.text = null;
        capture.mimeType = blob instanceof Blob ? blob.type : null;

        if (blob instanceof Blob) {
          blob
            .text()
            .then((text) => {
              capture.text = text;
              capture.ready = true;
            })
            .catch((error: unknown) => {
              capture.error = String(error);
              capture.ready = true;
            });
        } else {
          capture.ready = true;
        }

        win.__downloadCapture = capture;
        return originalCreateObjectURL(blob);
      }) as typeof URL.createObjectURL;

      document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
        const element = originalCreateElement(tagName, options);

        if (tagName.toLowerCase() === 'a') {
          const anchor = element as HTMLAnchorElement;
          const originalClick = anchor.click.bind(anchor);

          anchor.click = () => {
            const capture = win.__downloadCapture ?? {};
            capture.filename = anchor.download || null;
            win.__downloadCapture = capture;
            return originalClick();
          };
        }

        return element;
      }) as typeof document.createElement;

      win.__downloadCaptureInstalled = true;
    }

    win.__downloadCapture = {
      filename: null,
      text: null,
      mimeType: null,
      ready: false,
      error: null,
    };
  });
}

async function waitForDownloadCapture(): Promise<DownloadCapture> {
  await browser.waitUntil(
    async () => {
      const capture = (await browser.execute(
        () => (window as any).__downloadCapture,
      )) as DownloadCapture | null;

      return Boolean(capture?.filename) && Boolean(capture?.ready);
    },
    {
      timeout: 10_000,
      timeoutMsg: 'Expected encrypted export download to be captured',
    },
  );

  return (await browser.execute(
    () => (window as any).__downloadCapture,
  )) as DownloadCapture;
}

async function exportEncryptedJson(includePasswords: boolean): Promise<DownloadCapture> {
  await openExportTab();
  await selectExportFormat('JSON');
  await setIncludePasswords(includePasswords);
  await setEncryptedExport(true, EXPORT_PASSWORD);
  await installDownloadCapture();

  const exportButton = await $(S.exportConfirm);
  await exportButton.waitForClickable({ timeout: 5_000 });
  await exportButton.click();

  return waitForDownloadCapture();
}

async function stubPrompt(response: string | null): Promise<void> {
  await browser.execute((nextResponse: string | null) => {
    const win = window as any;
    win.__promptCalls = [];
    win.prompt = (message?: string) => {
      win.__promptCalls.push(String(message ?? ''));
      return nextResponse;
    };
  }, response);
}

async function getPromptCalls(): Promise<string[]> {
  return (await browser.execute(() => (window as any).__promptCalls ?? [])) as string[];
}

async function injectVirtualFile(
  content: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  await browser.execute(
    (selector: string, fileName: string, fileContent: string, type: string) => {
      const input = document.querySelector(selector) as HTMLInputElement | null;
      if (!input) {
        throw new Error(`Input not found for selector: ${selector}`);
      }

      const file = new File([new Blob([fileContent], { type })], fileName, { type });
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
    mimeType,
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

function requireExportText(capture: DownloadCapture): string {
  if (!capture.text) {
    throw new Error('Expected encrypted export content to be captured');
  }

  return capture.text;
}

function asEncryptedFilename(filename: string | null): string {
  if (!filename) {
    return 'sortofremoteng-exports.encrypted.json';
  }

  const match = filename.match(/^(.*?)(\.[^.]+)$/);
  if (!match) {
    return `${filename}.encrypted`;
  }

  return `${match[1]}.encrypted${match[2]}`;
}

describe('Export Encryption', () => {
  beforeEach(async () => {
    await prepareCollection('Encrypted Export Test');
    await addTestConnection(ROUND_TRIP_CONNECTION);
  });

  it('exports encrypted JSON without leaking plaintext connection data', async () => {
    const capture = await exportEncryptedJson(false);
    const text = requireExportText(capture);

    expect(capture.error).toBeNull();
    expect(capture.filename).toMatch(/^sortofremoteng-exports-.*\.json$/);
    expect(capture.mimeType).toBe('application/json');
    expect(text).not.toContain(ROUND_TRIP_CONNECTION.name);
    expect(text).not.toContain(ROUND_TRIP_CONNECTION.hostname);
    expect(text).not.toContain(ROUND_TRIP_CONNECTION.password);
  });

  it('reimports exported encrypted JSON when the correct decryption password is provided', async () => {
    const capture = await exportEncryptedJson(true);
    const text = requireExportText(capture);

    await prepareCollection('Encrypted Import Test');
    await openImportTab();
    await stubPrompt(EXPORT_PASSWORD);
    await injectVirtualFile(text, asEncryptedFilename(capture.filename), 'application/json');

    const previewText = await (await $(S.importPreview)).getText();
    const promptCalls = await getPromptCalls();
    expect(promptCalls).toEqual(['Enter decryption password:']);
    expect(previewText).toContain('Import Successful');
    expect(previewText).toContain('Found 1 connections ready to import.');

    await confirmImport();
    await waitForConnectionName('Encrypted SSH');

    const editor = await openConnectionEditor('Encrypted SSH');
    expect(await (await editor.$(S.editorHostname)).getValue()).toBe('enc.example.com');
    expect(await (await findVisibleEditorField(editor, S.editorUsername)).getValue()).toBe('vault-admin');
    expect(await (await findVisibleEditorField(editor, S.editorPassword)).getValue()).toBe('VaultPass!42');
  });

  it('rejects exported encrypted JSON when the wrong password is supplied', async () => {
    const capture = await exportEncryptedJson(true);
    const text = requireExportText(capture);

    await prepareCollection('Encrypted Import Failure');
    await openImportTab();
    await stubPrompt('TotallyWrongP@ss');
    await injectVirtualFile(text, asEncryptedFilename(capture.filename), 'application/json');

    const previewText = await (await $(S.importPreview)).getText();
    const promptCalls = await getPromptCalls();
    expect(promptCalls).toEqual(['Enter decryption password:']);
    expect(previewText).toContain('Import Failed');
    expect(previewText).toContain('Failed to decrypt file. Check your password.');
  });
});
