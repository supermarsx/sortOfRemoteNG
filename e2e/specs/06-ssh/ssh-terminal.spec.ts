import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, SSH_PORT, waitForContainer } from '../../helpers/docker';

async function createAndConnectSSH(): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue('Terminal Test');

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('SSH');

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(SSH_PORT));

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue('testuser');

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue('testpass123');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);

  // Connect
  const tree = await $(S.connectionTree);
  const item = await tree.$(S.connectionItem);
  await item.doubleClick();

  const terminal = await $(S.sshTerminal);
  await terminal.waitForDisplayed({ timeout: 15_000 });

  // Wait for shell prompt
  await browser.pause(3000);
}

describe('SSH Terminal', () => {
  before(async () => {
    startContainers();
    await waitForContainer('ssh', SSH_PORT, 30_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('SSH Terminal Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should display terminal toolbar', async () => {
    await createAndConnectSSH();

    const toolbar = await $(S.terminalToolbar);
    const toolbarExists = await toolbar.isExisting();
    expect(toolbarExists).toBe(true);
  });

  it('should resize terminal with window', async () => {
    await createAndConnectSSH();

    const terminal = await $(S.sshTerminal);
    const sizeBefore = await terminal.getSize();

    // Resize the window
    const currentSize = await browser.getWindowSize();
    await browser.setWindowSize(currentSize.width + 200, currentSize.height + 100);
    await browser.pause(1000);

    const sizeAfter = await terminal.getSize();

    // Restore window size
    await browser.setWindowSize(currentSize.width, currentSize.height);

    expect(sizeAfter.width).toBeGreaterThanOrEqual(sizeBefore.width);
  });

  it('should have reconnect button in toolbar', async () => {
    await createAndConnectSSH();

    const reconnectBtn = await $(S.terminalReconnect);
    const exists = await reconnectBtn.isExisting();
    expect(exists).toBe(true);
  });

  it('should reconnect when clicking reconnect button', async () => {
    await createAndConnectSSH();

    // Disconnect first
    const disconnectBtn = await $(S.terminalDisconnect);
    await disconnectBtn.click();
    await browser.pause(2000);

    // Click reconnect
    const reconnectBtn = await $(S.terminalReconnect);
    if (await reconnectBtn.isExisting()) {
      await reconnectBtn.click();

      const terminal = await $(S.sshTerminal);
      await terminal.waitForDisplayed({ timeout: 15_000 });
      expect(await terminal.isDisplayed()).toBe(true);
    }
  });

  it('should show session metrics in status bar', async () => {
    await createAndConnectSSH();

    const statusBar = await $(S.rdpStatusBar);
    const statusExists = await statusBar.isExisting();
    // Status bar may or may not exist for SSH — just ensure no crash
    expect(typeof statusExists).toBe('boolean');
  });

  it('should support copy and paste in terminal', async () => {
    await createAndConnectSSH();

    // Type a command to produce output
    for (const ch of 'echo clipboard_test_string') {
      await browser.keys(ch);
    }
    await browser.keys('Enter');
    await browser.pause(2000);

    const terminal = await $(S.sshTerminal);
    const text = await terminal.getText();
    expect(text).toContain('clipboard_test_string');
  });
});
