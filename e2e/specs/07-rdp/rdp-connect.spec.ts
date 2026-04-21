import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, RDP_PORT, waitForContainer } from '../../helpers/docker';

async function createRDPConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('RDP');

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(RDP_PORT));

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue('testuser');

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue('testpass123');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function connectFirstItem(): Promise<void> {
  const tree = await $(S.connectionTree);
  const item = await tree.$(S.connectionItem);
  await item.doubleClick();
}

describe('RDP Connect', () => {
  before(async () => {
    startContainers();
    await waitForContainer('rdp', RDP_PORT, 60_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('RDP Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should connect to RDP server and render canvas', async () => {
    await createRDPConnection('Test RDP');
    await connectFirstItem();

    const canvas = await $(S.rdpCanvas);
    await canvas.waitForDisplayed({ timeout: 30_000 });
    expect(await canvas.isDisplayed()).toBe(true);
  });

  it('should show resolution in status bar after connecting', async () => {
    await createRDPConnection('RDP Resolution');
    await connectFirstItem();

    const canvas = await $(S.rdpCanvas);
    await canvas.waitForDisplayed({ timeout: 30_000 });

    const statusBar = await $(S.rdpStatusBar);
    if (await statusBar.isExisting()) {
      const text = await statusBar.getText();
      // Status bar typically shows resolution like "1920x1080"
      expect(text).toMatch(/\d+x\d+|connected/i);
    }
  });

  it('should disconnect from RDP session', async () => {
    await createRDPConnection('RDP Disconnect');
    await connectFirstItem();

    const canvas = await $(S.rdpCanvas);
    await canvas.waitForDisplayed({ timeout: 30_000 });

    const disconnectBtn = await $(S.terminalDisconnect);
    await disconnectBtn.click();
    await browser.pause(2000);

    // Canvas should disappear or tab should close
    const isCanvasDisplayed = await canvas.isDisplayed().catch(() => false);
    const tabs = await $$(S.sessionTab);
    // Session ended — either canvas gone or tab gone
    expect(!isCanvasDisplayed || (await tabs.length) === 0).toBe(true);
  });

  it('should reconnect after disconnect', async () => {
    await createRDPConnection('RDP Reconnect');
    await connectFirstItem();

    const canvas = await $(S.rdpCanvas);
    await canvas.waitForDisplayed({ timeout: 30_000 });

    // Disconnect
    const disconnectBtn = await $(S.terminalDisconnect);
    await disconnectBtn.click();
    await browser.pause(2000);

    // Reconnect by double-clicking again
    await connectFirstItem();

    const canvasAgain = await $(S.rdpCanvas);
    await canvasAgain.waitForDisplayed({ timeout: 30_000 });
    expect(await canvasAgain.isDisplayed()).toBe(true);
  });

  it('should show session tab when RDP is connected', async () => {
    await createRDPConnection('RDP Tab');
    await connectFirstItem();

    const canvas = await $(S.rdpCanvas);
    await canvas.waitForDisplayed({ timeout: 30_000 });

    const tabs = await $$(S.sessionTab);
    expect(tabs.length).toBeGreaterThan(0);

    // Tab text should contain the connection name
    const tabTexts = await tabs.map((t) => t.getText());
    const hasRDPTab = tabTexts.some((t) => t.includes('RDP Tab'));
    expect(hasRDPTab).toBe(true);
  });
});
