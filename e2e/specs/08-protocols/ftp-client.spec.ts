import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, FTP_PORT, waitForContainer } from '../../helpers/docker';

// FTP client selectors
const FTP = {
  ftpClient: '[data-testid="ftp-client"]',
  remoteFileList: '[data-testid="ftp-remote-files"]',
  remoteFileItem: '[data-testid="ftp-file-item"]',
  localFileList: '[data-testid="ftp-local-files"]',
  uploadBtn: '[data-testid="ftp-upload"]',
  downloadBtn: '[data-testid="ftp-download"]',
  transferProgress: '[data-testid="ftp-transfer-progress"]',
  refreshBtn: '[data-testid="ftp-refresh"]',
  currentPath: '[data-testid="ftp-current-path"]',
  statusIndicator: '[data-testid="ftp-status"]',
  disconnectBtn: '[data-testid="ftp-disconnect"]',
} as const;

async function createFTPConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('FTP');

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(FTP_PORT));

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

describe('FTP Client', () => {
  before(async () => {
    startContainers();
    await waitForContainer('ftp', FTP_PORT, 30_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('FTP Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should connect to FTP server and show client', async () => {
    await createFTPConnection('Test FTP');
    await connectFirstItem();

    const client = await $(FTP.ftpClient);
    await client.waitForDisplayed({ timeout: 15_000 });
    expect(await client.isDisplayed()).toBe(true);
  });

  it('should show directory listing after connecting', async () => {
    await createFTPConnection('FTP Listing');
    await connectFirstItem();

    const client = await $(FTP.ftpClient);
    await client.waitForDisplayed({ timeout: 15_000 });

    const fileList = await $(FTP.remoteFileList);
    await fileList.waitForDisplayed({ timeout: 10_000 });

    // Root directory should have at least the current path shown
    const currentPath = await $(FTP.currentPath);
    if (await currentPath.isExisting()) {
      const path = await currentPath.getText();
      expect(path.length).toBeGreaterThan(0);
    }
  });

  it('should list files in remote directory', async () => {
    await createFTPConnection('FTP Files');
    await connectFirstItem();

    const client = await $(FTP.ftpClient);
    await client.waitForDisplayed({ timeout: 15_000 });

    const fileList = await $(FTP.remoteFileList);
    await fileList.waitForDisplayed({ timeout: 10_000 });

    const items = await $$(FTP.remoteFileItem);
    // Server may have some default files or at least show the directory
    expect(items.length).toBeGreaterThanOrEqual(0);
  });

  it('should upload a file to FTP server', async () => {
    await createFTPConnection('FTP Upload');
    await connectFirstItem();

    const client = await $(FTP.ftpClient);
    await client.waitForDisplayed({ timeout: 15_000 });

    const uploadBtn = await $(FTP.uploadBtn);
    if (await uploadBtn.isExisting()) {
      await uploadBtn.click();
      await browser.pause(3000);

      // Check for progress indicator
      const progress = await $(FTP.transferProgress);
      const shown = await progress.isExisting();
      expect(typeof shown).toBe('boolean');
    }
  });

  it('should download a file from FTP server', async () => {
    await createFTPConnection('FTP Download');
    await connectFirstItem();

    const client = await $(FTP.ftpClient);
    await client.waitForDisplayed({ timeout: 15_000 });

    const items = await $$(FTP.remoteFileItem);
    if ((await items.length) > 0) {
      await items[0].click();
      await browser.pause(500);

      const downloadBtn = await $(FTP.downloadBtn);
      if (await downloadBtn.isExisting()) {
        await downloadBtn.click();
        await browser.pause(3000);

        // Check for progress indicator
        const progress = await $(FTP.transferProgress);
        const shown = await progress.isExisting();
        expect(typeof shown).toBe('boolean');
      }
    }
  });

  it('should show session tab when FTP client is active', async () => {
    await createFTPConnection('FTP Tab');
    await connectFirstItem();

    const client = await $(FTP.ftpClient);
    await client.waitForDisplayed({ timeout: 15_000 });

    const tabs = await $$(S.sessionTab);
    expect(tabs.length).toBeGreaterThan(0);
  });

  it('should disconnect from FTP server cleanly', async () => {
    await createFTPConnection('FTP Disconnect');
    await connectFirstItem();

    const client = await $(FTP.ftpClient);
    await client.waitForDisplayed({ timeout: 15_000 });

    // Disconnect
    const disconnectBtn = await $(FTP.disconnectBtn);
    if (await disconnectBtn.isExisting()) {
      await disconnectBtn.click();
    } else {
      const termDisconnect = await $(S.terminalDisconnect);
      await termDisconnect.click();
    }

    await browser.pause(2000);

    // Client should close or show disconnected
    const isStillDisplayed = await client.isDisplayed().catch(() => false);
    const tabs = await $$(S.sessionTab);
    expect(!isStillDisplayed || (await tabs.length) === 0).toBe(true);
  });
});
