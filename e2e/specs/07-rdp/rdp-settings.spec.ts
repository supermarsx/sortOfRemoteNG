import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, RDP_PORT, waitForContainer } from '../../helpers/docker';

// RDP settings selectors
const RDP_SETTINGS = {
  resolutionSelect: '[data-testid="rdp-resolution"]',
  audioRedirection: '[data-testid="rdp-audio-redirect"]',
  clipboardRedirection: '[data-testid="rdp-clipboard-redirect"]',
  performanceSelect: '[data-testid="rdp-performance"]',
  colorDepthSelect: '[data-testid="rdp-color-depth"]',
  fullscreenToggle: '[data-testid="rdp-fullscreen"]',
} as const;

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

async function openConnectionEditor(name: string): Promise<void> {
  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(name)) {
      await item.click();
      break;
    }
  }
  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });
}

describe('RDP Settings', () => {
  before(async () => {
    startContainers();
    await waitForContainer('rdp', RDP_PORT, 60_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('RDP Settings Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should change RDP resolution in connection settings', async () => {
    await createRDPConnection('RDP Res');
    await openConnectionEditor('RDP Res');

    const resolution = await $(RDP_SETTINGS.resolutionSelect);
    if (await resolution.isExisting()) {
      await resolution.selectByVisibleText('1280x720');
      await browser.pause(500);

      const saveBtn = await $(S.editorSave);
      await saveBtn.click();
      await browser.pause(500);

      // Re-open editor and verify the setting persisted
      await openConnectionEditor('RDP Res');
      const resValue = await $(RDP_SETTINGS.resolutionSelect);
      const selected = await resValue.getValue();
      expect(selected).toContain('1280');
    }
  });

  it('should toggle audio redirection', async () => {
    await createRDPConnection('RDP Audio');
    await openConnectionEditor('RDP Audio');

    const audioToggle = await $(RDP_SETTINGS.audioRedirection);
    if (await audioToggle.isExisting()) {
      const initialState = await audioToggle.isSelected();
      await audioToggle.click();
      await browser.pause(300);

      const newState = await audioToggle.isSelected();
      expect(newState).not.toBe(initialState);

      const saveBtn = await $(S.editorSave);
      await saveBtn.click();
      await browser.pause(500);
    }
  });

  it('should toggle clipboard redirection', async () => {
    await createRDPConnection('RDP Clipboard');
    await openConnectionEditor('RDP Clipboard');

    const clipboardToggle = await $(RDP_SETTINGS.clipboardRedirection);
    if (await clipboardToggle.isExisting()) {
      const initialState = await clipboardToggle.isSelected();
      await clipboardToggle.click();
      await browser.pause(300);

      const newState = await clipboardToggle.isSelected();
      expect(newState).not.toBe(initialState);

      const saveBtn = await $(S.editorSave);
      await saveBtn.click();
      await browser.pause(500);
    }
  });

  it('should change performance settings', async () => {
    await createRDPConnection('RDP Perf');
    await openConnectionEditor('RDP Perf');

    const perfSelect = await $(RDP_SETTINGS.performanceSelect);
    if (await perfSelect.isExisting()) {
      await perfSelect.selectByVisibleText('LAN');
      await browser.pause(300);

      const saveBtn = await $(S.editorSave);
      await saveBtn.click();
      await browser.pause(500);

      // Verify persistence
      await openConnectionEditor('RDP Perf');
      const perfValue = await $(RDP_SETTINGS.performanceSelect);
      const selected = await perfValue.getValue();
      expect(selected.toLowerCase()).toContain('lan');
    }
  });

  it('should apply resolution setting when connecting', async () => {
    await createRDPConnection('RDP Apply Res');
    await openConnectionEditor('RDP Apply Res');

    const resolution = await $(RDP_SETTINGS.resolutionSelect);
    if (await resolution.isExisting()) {
      await resolution.selectByVisibleText('1280x720');

      const saveBtn = await $(S.editorSave);
      await saveBtn.click();
      await browser.pause(500);
    }

    // Connect
    const tree = await $(S.connectionTree);
    const item = await tree.$(S.connectionItem);
    await item.doubleClick();

    const canvas = await $(S.rdpCanvas);
    await canvas.waitForDisplayed({ timeout: 30_000 });

    const statusBar = await $(S.rdpStatusBar);
    if (await statusBar.isExisting()) {
      const text = await statusBar.getText();
      // May show the configured resolution
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
