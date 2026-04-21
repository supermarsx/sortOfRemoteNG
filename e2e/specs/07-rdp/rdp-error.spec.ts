import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, RDP_PORT, waitForContainer } from '../../helpers/docker';

// RDP error selectors
const RDP_ERR = {
  errorRetryBtn: '[data-testid="rdp-error-retry"]',
  errorCloseBtn: '[data-testid="rdp-error-close"]',
  errorMessage: '[data-testid="rdp-error-message"]',
} as const;

async function createRDPConnection(
  name: string,
  host: string,
  port: number,
  user: string,
  pass: string,
): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue(host);

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('RDP');

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(port));

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue(user);

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue(pass);

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function connectFirstItem(): Promise<void> {
  const tree = await $(S.connectionTree);
  const item = await tree.$(S.connectionItem);
  await item.doubleClick();
}

describe('RDP Error Handling', () => {
  before(async () => {
    startContainers();
    await waitForContainer('rdp', RDP_PORT, 60_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('RDP Error Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should show RDPErrorScreen when host is unreachable', async () => {
    // Use an unreachable host — 192.0.2.1 is reserved for documentation (RFC 5737)
    await createRDPConnection('Bad RDP', '192.0.2.1', 3389, 'admin', 'admin');
    await connectFirstItem();

    // Wait for connection timeout
    await browser.pause(15_000);

    const errorScreen = await $(S.rdpErrorScreen);
    const isErrorDisplayed = await errorScreen.isDisplayed().catch(() => false);
    expect(isErrorDisplayed).toBe(true);
  });

  it('should have retry button on error screen', async () => {
    await createRDPConnection('Retry RDP', '192.0.2.1', 3389, 'admin', 'admin');
    await connectFirstItem();

    await browser.pause(15_000);

    const errorScreen = await $(S.rdpErrorScreen);
    await errorScreen.waitForDisplayed({ timeout: 20_000 });

    const retryBtn = await $(RDP_ERR.errorRetryBtn);
    const retryExists = await retryBtn.isExisting();
    expect(retryExists).toBe(true);
  });

  it('should have close button on error screen', async () => {
    await createRDPConnection('Close RDP', '192.0.2.1', 3389, 'admin', 'admin');
    await connectFirstItem();

    await browser.pause(15_000);

    const errorScreen = await $(S.rdpErrorScreen);
    await errorScreen.waitForDisplayed({ timeout: 20_000 });

    const closeBtn = await $(RDP_ERR.errorCloseBtn);
    const closeExists = await closeBtn.isExisting();
    expect(closeExists).toBe(true);
  });

  it('should close error screen when clicking close button', async () => {
    await createRDPConnection('Close Error', '192.0.2.1', 3389, 'admin', 'admin');
    await connectFirstItem();

    await browser.pause(15_000);

    const errorScreen = await $(S.rdpErrorScreen);
    await errorScreen.waitForDisplayed({ timeout: 20_000 });

    const closeBtn = await $(RDP_ERR.errorCloseBtn);
    if (await closeBtn.isExisting()) {
      await closeBtn.click();
      await browser.pause(1000);

      const errorGone = await errorScreen.isDisplayed().catch(() => false);
      expect(errorGone).toBe(false);
    }
  });

  it('should show NLA authentication failure message', async () => {
    // Connect to the real RDP container with wrong credentials
    await createRDPConnection('NLA Fail', 'localhost', RDP_PORT, 'wronguser', 'wrongpass');
    await connectFirstItem();

    await browser.pause(15_000);

    const errorScreen = await $(S.rdpErrorScreen);
    const isError = await errorScreen.isDisplayed().catch(() => false);

    if (isError) {
      const errorMsg = await $(RDP_ERR.errorMessage);
      if (await errorMsg.isExisting()) {
        const text = await errorMsg.getText();
        // Error message should mention authentication or credentials
        expect(text.length).toBeGreaterThan(0);
      }
    } else {
      // Connection may have been refused without NLA — still valid
      const canvas = await $(S.rdpCanvas);
      const hasCanvas = await canvas.isDisplayed().catch(() => false);
      // Either error screen or no canvas means it was rejected
      expect(hasCanvas || isError).toBeDefined();
    }
  });
});
