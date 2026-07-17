import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

// t54-B: the Connect-from-editor button has no entry in the shared selector
// map; use an inline selector, mirroring how this file already targets the
// SSH-specific option fields.
const EDITOR_CONNECT = '[data-testid="editor-connect"]';

async function sessionTabExists(connectionName: string): Promise<boolean> {
  const tabs = await $$(S.sessionTab);
  for (const tab of tabs) {
    if ((await tab.getText()).includes(connectionName)) {
      return true;
    }
  }
  return false;
}

async function createTestConnection(
  name: string,
  hostname: string,
  protocol: string,
  port: string,
): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  await (await $(S.editorName)).setValue(name);
  await (await $(S.editorHostname)).setValue(hostname);
  await (await $(S.editorProtocol)).selectByVisibleText(protocol);

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(port);

  await (await $(S.editorSave)).click();
  await browser.pause(500);
}

async function selectConnection(name: string): Promise<void> {
  const items = await $$(S.connectionItem);
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(name)) {
      await item.click();
      const editor = await $(S.editorPanel);
      await editor.waitForDisplayed({ timeout: 5_000 });
      return;
    }
  }
  throw new Error(`Connection "${name}" not found in tree`);
}

describe('Connection Editing', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    // Seed test data
    await createTestConnection('Alpha', '192.168.1.10', 'SSH', '22');
    await createTestConnection('Bravo', '10.0.0.20', 'RDP', '3389');
    await createTestConnection('Charlie', 'https://charlie.local', 'HTTP', '443');
  });

  it('should open editor with current values when selecting a connection', async () => {
    await selectConnection('Alpha');

    const nameInput = await $(S.editorName);
    expect(await nameInput.getValue()).toBe('Alpha');

    const hostnameInput = await $(S.editorHostname);
    expect(await hostnameInput.getValue()).toBe('192.168.1.10');

    const portInput = await $(S.editorPort);
    expect(await portInput.getValue()).toBe('22');
  });

  it('should modify hostname and persist after save', async () => {
    await selectConnection('Alpha');

    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.clearValue();
    await hostnameInput.setValue('10.10.10.10');

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    // Re-select and verify
    await selectConnection('Bravo');
    await browser.pause(300);
    await selectConnection('Alpha');

    const updatedHostname = await $(S.editorHostname);
    expect(await updatedHostname.getValue()).toBe('10.10.10.10');
  });

  it('should allow editing SSH-specific options', async () => {
    await selectConnection('Alpha');

    // Look for SSH-specific option fields
    const timeoutInput = await $('[data-testid="editor-ssh-timeout"]');
    if (await timeoutInput.isExisting()) {
      await timeoutInput.clearValue();
      await timeoutInput.setValue('30');
    }

    const keepaliveInput = await $('[data-testid="editor-ssh-keepalive"]');
    if (await keepaliveInput.isExisting()) {
      await keepaliveInput.clearValue();
      await keepaliveInput.setValue('15');
    }

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    // Re-select and verify
    await selectConnection('Bravo');
    await browser.pause(300);
    await selectConnection('Alpha');

    if (await timeoutInput.isExisting()) {
      expect(await $('[data-testid="editor-ssh-timeout"]').getValue()).toBe('30');
    }
    if (await keepaliveInput.isExisting()) {
      expect(await $('[data-testid="editor-ssh-keepalive"]').getValue()).toBe('15');
    }
  });

  it('should update default port when protocol is changed', async () => {
    await selectConnection('Alpha');

    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('RDP');
    await browser.pause(300);

    const portInput = await $(S.editorPort);
    expect(await portInput.getValue()).toBe('3389');

    await protocolSelect.selectByVisibleText('VNC');
    await browser.pause(300);
    expect(await portInput.getValue()).toBe('5900');
  });

  it('should auto-save after modification and a brief wait', async () => {
    await selectConnection('Bravo');

    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.clearValue();
    await hostnameInput.setValue('172.16.0.99');

    // Wait for auto-save to trigger
    await browser.pause(3_000);

    // Navigate away and back
    await selectConnection('Alpha');
    await browser.pause(300);
    await selectConnection('Bravo');

    const updatedHostname = await $(S.editorHostname);
    expect(await updatedHostname.getValue()).toBe('172.16.0.99');
  });

  // t54-B — Connect from the edit tab. NOTE: like every spec here this runs
  // only under the gate's Tauri driver rig (wdio.conf.ts hard-requires a built
  // binary); it is authored to the contract, not executed in the unit gate.
  describe('Connect from the editor (t54-B)', () => {
    it('shows a Connect button for a saved connection', async () => {
      await selectConnection('Alpha');

      const connectBtn = await $(EDITOR_CONNECT);
      await connectBtn.waitForDisplayed({ timeout: 5_000 });
      expect(await connectBtn.isDisplayed()).toBe(true);
    });

    it('opens a session tab when Connect is clicked', async () => {
      await selectConnection('Bravo');

      const connectBtn = await $(EDITOR_CONNECT);
      await connectBtn.waitForDisplayed({ timeout: 5_000 });
      await connectBtn.click();
      await browser.pause(1_000);

      expect(await sessionTabExists('Bravo')).toBe(true);
    });

    it('save-then-connect: connects to the freshly edited hostname', async () => {
      await selectConnection('Alpha');

      const hostnameInput = await $(S.editorHostname);
      await hostnameInput.clearValue();
      await hostnameInput.setValue('10.20.30.40');

      const connectBtn = await $(EDITOR_CONNECT);
      await connectBtn.waitForDisplayed({ timeout: 5_000 });
      await connectBtn.click();
      await browser.pause(1_000);

      // A session tab opened for the connection...
      expect(await sessionTabExists('Alpha')).toBe(true);

      // ...and Connect implicitly persisted the edit (the editor stays open for
      // an existing connection, so re-selecting shows the saved new hostname).
      await selectConnection('Charlie');
      await browser.pause(300);
      await selectConnection('Alpha');
      expect(await (await $(S.editorHostname)).getValue()).toBe('10.20.30.40');
    });

    it('keeps the edit tab open after connecting (existing connection)', async () => {
      await selectConnection('Bravo');

      const connectBtn = await $(EDITOR_CONNECT);
      await connectBtn.waitForDisplayed({ timeout: 5_000 });
      await connectBtn.click();
      await browser.pause(1_000);

      // The editor is not unmounted by a connect on an existing connection.
      expect(await (await $(S.editorPanel)).isDisplayed()).toBe(true);
    });

    it('hides the Connect button for a new, unsaved connection', async () => {
      const addBtn = await $(S.toolbarNewConnection);
      await addBtn.click();

      const editor = await $(S.editorPanel);
      await editor.waitForDisplayed({ timeout: 5_000 });

      // There is no saved record to connect to yet, so the button is absent.
      expect(await (await $(EDITOR_CONNECT)).isExisting()).toBe(false);
    });
  });
});
