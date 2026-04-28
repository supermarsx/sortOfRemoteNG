import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, SSH_PORT, waitForContainer } from '../../helpers/docker';
import { selectCustomOption } from '../../helpers/forms';
import {
  countTextOccurrences,
  getSshTerminalText,
  openConnectionItem,
  waitForConnectionItem,
  waitForSessionTab,
  waitForSshConnected,
  waitForSshDisconnected,
  waitForSshTerminalText,
} from '../../helpers/ssh';

async function createSSHConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  await selectCustomOption(S.editorProtocol, ['SSH (Secure Shell)', 'SSH']);

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(SSH_PORT));

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue('testuser');

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue('testpass123');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await waitForConnectionItem(name);
}

async function connectToSSH(name: string): Promise<void> {
  await openConnectionItem(name);
  await waitForSshConnected();
  await waitForSessionTab(name);
}

async function typeCommand(cmd: string): Promise<void> {
  for (const ch of cmd) {
    await browser.keys(ch);
  }
  await browser.keys('Enter');
}

describe('SSH Connect', () => {
  before(async () => {
    startContainers(['test-ssh']);
    await waitForContainer('ssh', SSH_PORT, 30_000);
  });

  after(async () => {
    stopContainers(['test-ssh']);
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('SSH Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should connect to SSH server and show terminal', async () => {
    const connectionName = 'Test SSH';
    await createSSHConnection(connectionName);
    await connectToSSH(connectionName);

    const terminal = await $(S.sshTerminal);
    expect(await terminal.isDisplayed()).toBe(true);
  });

  it('should show a connected shell state after connecting', async () => {
    const connectionName = 'Test SSH';
    await createSSHConnection(connectionName);
    await connectToSSH(connectionName);

    const text = await getSshTerminalText();
    expect(text).toContain('Shell started successfully');
    expect(text).toContain('Connected');
  });

  it('should execute whoami and show correct user', async () => {
    const connectionName = 'Test SSH';
    await createSSHConnection(connectionName);
    await connectToSSH(connectionName);

    const beforeText = await getSshTerminalText();
    const initialUserMatches = countTextOccurrences(beforeText, 'testuser');
    await typeCommand('whoami');

    const text = await waitForSshTerminalText(['testuser'], {
      previousText: beforeText,
      minOccurrences: {
        testuser: initialUserMatches + 1,
      },
      timeoutMsg: 'Expected whoami to print the SSH username',
    });

    expect(countTextOccurrences(text, 'testuser')).toBeGreaterThanOrEqual(initialUserMatches + 1);
  });

  it('should execute ls / and show common directories', async () => {
    const connectionName = 'Test SSH';
    await createSSHConnection(connectionName);
    await connectToSSH(connectionName);

    const beforeText = await getSshTerminalText();
    await typeCommand('ls /');

    const text = await waitForSshTerminalText(['bin', 'etc'], {
      previousText: beforeText,
      timeoutMsg: 'Expected ls / to list common root directories',
    });

    expect(text).toContain('bin');
    expect(text).toContain('etc');
  });

  it('should disconnect from SSH session', async () => {
    const connectionName = 'Test SSH';
    await createSSHConnection(connectionName);
    await connectToSSH(connectionName);

    const disconnectBtn = await $(S.terminalDisconnect);
    await disconnectBtn.click();

    const text = await waitForSshDisconnected();

    const terminal = await $(S.sshTerminal);
    const reconnectBtn = await $(S.terminalReconnect);

    expect(await terminal.isDisplayed()).toBe(true);
    expect(await disconnectBtn.isEnabled()).toBe(false);
    expect(await reconnectBtn.isDisplayed()).toBe(true);
    expect(text).toContain('Disconnected from SSH session');
    expect(text).toContain('Idle');
  });

  it('should keep the session tab available for reconnect after disconnect', async () => {
    const connectionName = 'Test SSH';
    await createSSHConnection(connectionName);
    await connectToSSH(connectionName);

    const disconnectBtn = await $(S.terminalDisconnect);
    await disconnectBtn.click();
    await waitForSshDisconnected();
    await waitForSessionTab(connectionName);

    const tabs = await $$(S.sessionTab);
    const tabTexts = await tabs.map((tab) => tab.getText());
    const reconnectBtn = await $(S.terminalReconnect);

    expect(tabTexts.some((text) => text.includes(connectionName))).toBe(true);
    expect(await reconnectBtn.isDisplayed()).toBe(true);
    expect(await reconnectBtn.isEnabled()).toBe(true);
  });
});
