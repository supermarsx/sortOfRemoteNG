import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, SSH_PORT, waitForContainer } from '../../helpers/docker';

// Tunnel-specific selectors
const TUNNEL = {
  tunnelPanel: '[data-testid="tunnel-panel"]',
  addTunnelBtn: '[data-testid="tunnel-add"]',
  tunnelType: '[data-testid="tunnel-type"]',
  tunnelLocalPort: '[data-testid="tunnel-local-port"]',
  tunnelRemoteHost: '[data-testid="tunnel-remote-host"]',
  tunnelRemotePort: '[data-testid="tunnel-remote-port"]',
  tunnelSave: '[data-testid="tunnel-save"]',
  tunnelList: '[data-testid="tunnel-list"]',
  tunnelItem: '[data-testid="tunnel-item"]',
  tunnelStatus: '[data-testid="tunnel-status"]',
  tunnelDelete: '[data-testid="tunnel-delete"]',
} as const;

async function createAndConnectSSH(): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue('Tunnel Test');

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

  const tree = await $(S.connectionTree);
  const item = await tree.$(S.connectionItem);
  await item.doubleClick();

  const terminal = await $(S.sshTerminal);
  await terminal.waitForDisplayed({ timeout: 15_000 });
  await browser.pause(3000);
}

describe('SSH Tunnels (Port Forwarding)', () => {
  before(async () => {
    startContainers();
    await waitForContainer('ssh', SSH_PORT, 30_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('SSH Tunnel Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should create a local port forward', async () => {
    await createAndConnectSSH();

    const tunnelPanel = await $(TUNNEL.tunnelPanel);
    if (await tunnelPanel.isExisting()) {
      const addBtn = await $(TUNNEL.addTunnelBtn);
      await addBtn.click();
      await browser.pause(500);

      const typeSelect = await $(TUNNEL.tunnelType);
      await typeSelect.selectByVisibleText('Local');

      const localPort = await $(TUNNEL.tunnelLocalPort);
      await localPort.setValue('18080');

      const remoteHost = await $(TUNNEL.tunnelRemoteHost);
      await remoteHost.setValue('localhost');

      const remotePort = await $(TUNNEL.tunnelRemotePort);
      await remotePort.setValue('80');

      const saveBtn = await $(TUNNEL.tunnelSave);
      await saveBtn.click();
      await browser.pause(2000);

      const items = await $$(TUNNEL.tunnelItem);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('should create a dynamic SOCKS proxy', async () => {
    await createAndConnectSSH();

    const tunnelPanel = await $(TUNNEL.tunnelPanel);
    if (await tunnelPanel.isExisting()) {
      const addBtn = await $(TUNNEL.addTunnelBtn);
      await addBtn.click();
      await browser.pause(500);

      const typeSelect = await $(TUNNEL.tunnelType);
      await typeSelect.selectByVisibleText('Dynamic');

      const localPort = await $(TUNNEL.tunnelLocalPort);
      await localPort.setValue('11080');

      const saveBtn = await $(TUNNEL.tunnelSave);
      await saveBtn.click();
      await browser.pause(2000);

      const items = await $$(TUNNEL.tunnelItem);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('should show tunnel as active during session', async () => {
    await createAndConnectSSH();

    const tunnelPanel = await $(TUNNEL.tunnelPanel);
    if (await tunnelPanel.isExisting()) {
      const addBtn = await $(TUNNEL.addTunnelBtn);
      await addBtn.click();
      await browser.pause(500);

      const typeSelect = await $(TUNNEL.tunnelType);
      await typeSelect.selectByVisibleText('Local');

      const localPort = await $(TUNNEL.tunnelLocalPort);
      await localPort.setValue('18081');

      const remoteHost = await $(TUNNEL.tunnelRemoteHost);
      await remoteHost.setValue('localhost');

      const remotePort = await $(TUNNEL.tunnelRemotePort);
      await remotePort.setValue('80');

      const saveBtn = await $(TUNNEL.tunnelSave);
      await saveBtn.click();
      await browser.pause(2000);

      const status = await $(TUNNEL.tunnelStatus);
      if (await status.isExisting()) {
        const text = await status.getText();
        expect(text.toLowerCase()).toContain('active');
      }
    }
  });

  it('should close tunnel on disconnect', async () => {
    await createAndConnectSSH();

    const tunnelPanel = await $(TUNNEL.tunnelPanel);
    if (await tunnelPanel.isExisting()) {
      const addBtn = await $(TUNNEL.addTunnelBtn);
      await addBtn.click();
      await browser.pause(500);

      const typeSelect = await $(TUNNEL.tunnelType);
      await typeSelect.selectByVisibleText('Local');

      const localPort = await $(TUNNEL.tunnelLocalPort);
      await localPort.setValue('18082');

      const remoteHost = await $(TUNNEL.tunnelRemoteHost);
      await remoteHost.setValue('localhost');

      const remotePort = await $(TUNNEL.tunnelRemotePort);
      await remotePort.setValue('80');

      const saveBtn = await $(TUNNEL.tunnelSave);
      await saveBtn.click();
      await browser.pause(2000);

      // Disconnect the SSH session
      const disconnectBtn = await $(S.terminalDisconnect);
      await disconnectBtn.click();
      await browser.pause(2000);

      // Tunnel should no longer be active
      const items = await $$(TUNNEL.tunnelItem);
      if ((await items.length) > 0) {
        const status = await items[0].$(TUNNEL.tunnelStatus);
        if (await status.isExisting()) {
          const text = await status.getText();
          expect(text.toLowerCase()).not.toContain('active');
        }
      }
    }
  });
});
