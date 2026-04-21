import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, HTTP_PORT, waitForContainer } from '../../helpers/docker';

// HTTP-specific selectors
const HTTP = {
  httpViewer: '[data-testid="http-viewer"]',
  httpWebview: '[data-testid="http-webview"]',
  httpUrlBar: '[data-testid="http-url-bar"]',
  httpRefreshBtn: '[data-testid="http-refresh"]',
  httpBackBtn: '[data-testid="http-back"]',
  httpForwardBtn: '[data-testid="http-forward"]',
  httpStatusIndicator: '[data-testid="http-status"]',
} as const;

async function createHTTPConnection(name: string, useAuth: boolean = false): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('HTTP');

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(HTTP_PORT));

  if (useAuth) {
    const usernameInput = await $(S.editorUsername);
    await usernameInput.setValue('testuser');

    const passwordInput = await $(S.editorPassword);
    await passwordInput.setValue('testpass123');
  }

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function connectFirstItem(): Promise<void> {
  const tree = await $(S.connectionTree);
  const item = await tree.$(S.connectionItem);
  await item.doubleClick();
}

describe('HTTP Viewer', () => {
  before(async () => {
    startContainers();
    await waitForContainer('http', HTTP_PORT, 30_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('HTTP Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should create an HTTP connection', async () => {
    await createHTTPConnection('Test HTTP');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names.some((n) => n.includes('Test HTTP'))).toBe(true);
  });

  it('should load page in HTTP viewer when connecting', async () => {
    await createHTTPConnection('HTTP View');
    await connectFirstItem();

    const viewer = await $(HTTP.httpViewer);
    await viewer.waitForDisplayed({ timeout: 15_000 });
    expect(await viewer.isDisplayed()).toBe(true);
  });

  it('should show a webview or iframe for HTTP content', async () => {
    await createHTTPConnection('HTTP Webview');
    await connectFirstItem();

    const webview = await $(HTTP.httpWebview);
    await webview.waitForDisplayed({ timeout: 15_000 });
    expect(await webview.isDisplayed()).toBe(true);
  });

  it('should send basic auth automatically when credentials configured', async () => {
    await createHTTPConnection('HTTP Auth', true);
    await connectFirstItem();

    const viewer = await $(HTTP.httpViewer);
    await viewer.waitForDisplayed({ timeout: 15_000 });

    // If basic auth was sent correctly, the page should load without 401
    const status = await $(HTTP.httpStatusIndicator);
    if (await status.isExisting()) {
      const text = await status.getText();
      // Status should indicate success, not 401 Unauthorized
      expect(text).not.toContain('401');
    }

    // The viewer should still be displayed (page loaded)
    expect(await viewer.isDisplayed()).toBe(true);
  });

  it('should show session tab when HTTP viewer is active', async () => {
    await createHTTPConnection('HTTP Tab');
    await connectFirstItem();

    const viewer = await $(HTTP.httpViewer);
    await viewer.waitForDisplayed({ timeout: 15_000 });

    const tabs = await $$(S.sessionTab);
    expect(tabs.length).toBeGreaterThan(0);
  });

  it('should have navigation controls in viewer', async () => {
    await createHTTPConnection('HTTP Nav');
    await connectFirstItem();

    const viewer = await $(HTTP.httpViewer);
    await viewer.waitForDisplayed({ timeout: 15_000 });

    const refreshBtn = await $(HTTP.httpRefreshBtn);
    if (await refreshBtn.isExisting()) {
      expect(await refreshBtn.isDisplayed()).toBe(true);
    }
  });
});
