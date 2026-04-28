import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openImportExport } from '../../helpers/app';
import { selectCustomOption } from '../../helpers/forms';

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

interface ExportPayload {
  collection: {
    name: string;
  };
  connections: Array<Record<string, unknown>>;
}

const TEST_CONNECTIONS: TestConnection[] = [
  {
    name: 'Gateway SSH',
    hostname: 'gateway.example.com',
    protocol: 'SSH',
    port: '22',
    username: 'ops-admin',
    password: 'Sup3rSecret!',
  },
  {
    name: 'Windows Jump Box',
    hostname: 'jumpbox.example.com',
    protocol: 'RDP',
    port: '3389',
    username: 'Administrator',
    password: 'JumpBox!23',
  },
];

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

async function openExportTab(): Promise<void> {
  await openImportExport();

  const exportTab = await $(S.exportTab);
  await exportTab.waitForClickable({ timeout: 5_000 });
  await exportTab.click();

  await (await $(S.exportConfirm)).waitForDisplayed({ timeout: 10_000 });
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
      timeoutMsg: 'Expected export download to be captured',
    },
  );

  return (await browser.execute(
    () => (window as any).__downloadCapture,
  )) as DownloadCapture;
}

async function exportCurrentSelection(): Promise<DownloadCapture> {
  await installDownloadCapture();

  const exportButton = await $(S.exportConfirm);
  await exportButton.waitForClickable({ timeout: 5_000 });
  await exportButton.click();

  return waitForDownloadCapture();
}

function requireExportText(capture: DownloadCapture): string {
  if (!capture.text) {
    throw new Error('Expected exported content to be captured');
  }

  return capture.text;
}

describe('Export Connections', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Export Test');
    await (await $(S.connectionTree)).waitForDisplayed({ timeout: 10_000 });

    for (const connection of TEST_CONNECTIONS) {
      await addTestConnection(connection);
    }
  });

  it('exports JSON with redacted passwords by default', async () => {
    await openExportTab();
    await selectExportFormat('JSON');

    const capture = await exportCurrentSelection();
    const text = requireExportText(capture);
    const exported = JSON.parse(text) as ExportPayload;

    expect(capture.error).toBeNull();
    expect(capture.filename).toMatch(/^sortofremoteng-exports-.*\.json$/);
    expect(capture.mimeType).toBe('application/json');
    expect(exported.collection.name).toBe('Export Test');
    expect(exported.connections).toHaveLength(TEST_CONNECTIONS.length);

    const gateway = exported.connections.find(
      (connection) => connection.name === 'Gateway SSH',
    );
    expect(gateway).toBeDefined();
    expect(gateway?.hostname).toBe('gateway.example.com');
    expect(gateway?.password).toBe('***ENCRYPTED***');
  });

  it('includes saved passwords when explicitly enabled', async () => {
    await openExportTab();
    await selectExportFormat('JSON');
    await setIncludePasswords(true);

    const capture = await exportCurrentSelection();
    const text = requireExportText(capture);
    const exported = JSON.parse(text) as ExportPayload;

    const gateway = exported.connections.find(
      (connection) => connection.name === 'Gateway SSH',
    );
    expect(gateway).toBeDefined();
    expect(gateway?.password).toBe('Sup3rSecret!');
  });

  it('encrypts non-JSON exports and appends the .encrypted suffix', async () => {
    await openExportTab();
    await selectExportFormat('CSV');
    await setEncryptedExport(true, 'CsvEncrypt!42');

    const capture = await exportCurrentSelection();
    const text = requireExportText(capture);

    expect(capture.error).toBeNull();
    expect(capture.filename).toMatch(/^sortofremoteng-exports-.*\.encrypted\.csv$/);
    expect(text).not.toContain('Gateway SSH');
    expect(text).not.toContain('gateway.example.com');
    expect(text).not.toContain('Sup3rSecret!');
  });
});
