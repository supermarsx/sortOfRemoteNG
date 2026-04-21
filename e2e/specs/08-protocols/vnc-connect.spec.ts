import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, VNC_PORT, waitForContainer } from '../../helpers/docker';

// VNC-specific selectors
const VNC = {
  vncViewer: '[data-testid="vnc-viewer"]',
  vncCanvas: '[data-testid="vnc-canvas"]',
  vncStatusBar: '[data-testid="vnc-status-bar"]',
  vncDisconnect: '[data-testid="vnc-disconnect"]',
  vncPasswordDialog: '[data-testid="vnc-password-dialog"]',
  vncPasswordInput: '[data-testid="vnc-password-input"]',
  vncPasswordSubmit: '[data-testid="vnc-password-submit"]',
} as const;

async function createVNCConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('VNC');

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(VNC_PORT));

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue('vnctest123');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function connectFirstItem(): Promise<void> {
  const tree = await $(S.connectionTree);
  const item = await tree.$(S.connectionItem);
  await item.doubleClick();
}

describe('VNC Connect', () => {
  before(async () => {
    startContainers();
    await waitForContainer('vnc', VNC_PORT, 30_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('VNC Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should connect to VNC server and render viewer', async () => {
    await createVNCConnection('Test VNC');
    await connectFirstItem();

    // Handle password dialog if it appears
    const pwDialog = await $(VNC.vncPasswordDialog);
    if (await pwDialog.isExisting()) {
      const pwInput = await $(VNC.vncPasswordInput);
      await pwInput.setValue('vnctest123');
      const pwSubmit = await $(VNC.vncPasswordSubmit);
      await pwSubmit.click();
      await browser.pause(1000);
    }

    const viewer = await $(VNC.vncViewer);
    await viewer.waitForDisplayed({ timeout: 20_000 });
    expect(await viewer.isDisplayed()).toBe(true);
  });

  it('should show VNC canvas after connection', async () => {
    await createVNCConnection('VNC Canvas');
    await connectFirstItem();

    const pwDialog = await $(VNC.vncPasswordDialog);
    if (await pwDialog.isExisting()) {
      const pwInput = await $(VNC.vncPasswordInput);
      await pwInput.setValue('vnctest123');
      const pwSubmit = await $(VNC.vncPasswordSubmit);
      await pwSubmit.click();
      await browser.pause(1000);
    }

    const canvas = await $(VNC.vncCanvas);
    await canvas.waitForDisplayed({ timeout: 20_000 });
    expect(await canvas.isDisplayed()).toBe(true);
  });

  it('should show session tab when VNC is connected', async () => {
    await createVNCConnection('VNC Tab');
    await connectFirstItem();

    const pwDialog = await $(VNC.vncPasswordDialog);
    if (await pwDialog.isExisting()) {
      const pwInput = await $(VNC.vncPasswordInput);
      await pwInput.setValue('vnctest123');
      const pwSubmit = await $(VNC.vncPasswordSubmit);
      await pwSubmit.click();
      await browser.pause(1000);
    }

    const viewer = await $(VNC.vncViewer);
    await viewer.waitForDisplayed({ timeout: 20_000 });

    const tabs = await $$(S.sessionTab);
    expect(tabs.length).toBeGreaterThan(0);
  });

  it('should disconnect cleanly from VNC session', async () => {
    await createVNCConnection('VNC Disconnect');
    await connectFirstItem();

    const pwDialog = await $(VNC.vncPasswordDialog);
    if (await pwDialog.isExisting()) {
      const pwInput = await $(VNC.vncPasswordInput);
      await pwInput.setValue('vnctest123');
      const pwSubmit = await $(VNC.vncPasswordSubmit);
      await pwSubmit.click();
      await browser.pause(1000);
    }

    const viewer = await $(VNC.vncViewer);
    await viewer.waitForDisplayed({ timeout: 20_000 });

    // Disconnect
    const disconnectBtn = await $(VNC.vncDisconnect);
    if (await disconnectBtn.isExisting()) {
      await disconnectBtn.click();
    } else {
      const termDisconnect = await $(S.terminalDisconnect);
      await termDisconnect.click();
    }

    await browser.pause(2000);

    // Viewer should no longer be active
    const isStillDisplayed = await viewer.isDisplayed().catch(() => false);
    const tabs = await $$(S.sessionTab);
    expect(!isStillDisplayed || (await tabs.length) === 0).toBe(true);
  });
});
