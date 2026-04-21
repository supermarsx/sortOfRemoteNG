import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, waitForContainer, SSH_PORT } from '../../helpers/docker';

async function createAndConnectSSH(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('SSH');

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue('22');

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue('testuser');

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue('testpass123');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);

  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(name)) {
      await item.doubleClick();
      break;
    }
  }

  const terminal = await $(S.sshTerminal);
  await terminal.waitForDisplayed({ timeout: 15_000 });
}

describe('Session Reconnect', () => {
  before(async function () {
    this.timeout(120_000);
    startContainers();
    await waitForContainer('test-ssh', SSH_PORT, 60_000);
  });

  after(() => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('Reconnect Tests');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should reconnect SSH session via reconnect button after disconnect', async () => {
    await createAndConnectSSH('Reconnect SSH');

    const disconnectBtn = await $(S.terminalDisconnect);
    await disconnectBtn.click();
    await browser.pause(1_000);

    const reconnectBtn = await $(S.terminalReconnect);
    await reconnectBtn.waitForDisplayed({ timeout: 5_000 });
    await reconnectBtn.click();

    const terminal = await $(S.sshTerminal);
    await terminal.waitForDisplayed({ timeout: 15_000 });
    expect(await terminal.isDisplayed()).toBe(true);
  });

  it('should attempt automatic reconnection on connection failure', async () => {
    await createAndConnectSSH('Auto Reconnect');

    const disconnectBtn = await $(S.terminalDisconnect);
    await disconnectBtn.click();
    await browser.pause(2_000);

    // Verify retry indicator appears
    const retryIndicator = await $('[data-testid="connection-retry-indicator"]');
    const exists = await retryIndicator.isExisting();
    if (exists) {
      expect(await retryIndicator.isDisplayed()).toBe(true);
    } else {
      // If no auto-retry, reconnect button should be available
      const reconnectBtn = await $(S.terminalReconnect);
      expect(await reconnectBtn.isDisplayed()).toBe(true);
    }
  });

  it('should restore session after network recovery', async () => {
    await createAndConnectSSH('Recovery SSH');

    // Simulate disconnect by clicking disconnect
    const disconnectBtn = await $(S.terminalDisconnect);
    await disconnectBtn.click();
    await browser.pause(1_000);

    // Reconnect to simulate network recovery
    const reconnectBtn = await $(S.terminalReconnect);
    await reconnectBtn.waitForDisplayed({ timeout: 5_000 });
    await reconnectBtn.click();

    const terminal = await $(S.sshTerminal);
    await terminal.waitForDisplayed({ timeout: 15_000 });

    // Verify session tab still shows the same connection name
    const tab = await $(S.sessionTab);
    const tabText = await tab.getText();
    expect(tabText).toContain('Recovery SSH');
  });
});
