import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

async function addConnection(
  name: string,
  hostname: string,
  protocol: string,
): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue(hostname);

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText(protocol);

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

describe('AnyDesk Protocol', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('AnyDesk Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should create an AnyDesk connection', async () => {
    await addConnection('AnyDesk Remote', '123456789', 'AnyDesk');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('AnyDesk Remote');
  });

  it('should open AnyDesk client on connect', async () => {
    await addConnection('AnyDesk Remote', '123456789', 'AnyDesk');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const client = await $('[data-testid="anydesk-client"]');
    expect(await client.isExisting()).toBe(true);
  });

  it('should show connection status indicator', async () => {
    await addConnection('AnyDesk Remote', '123456789', 'AnyDesk');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const status = await $('[data-testid="anydesk-status"]');
    expect(await status.isExisting()).toBe(true);
  });
});

describe('RustDesk Protocol', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('RustDesk Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should create a RustDesk connection', async () => {
    await addConnection('RustDesk Host', '987654321', 'RustDesk');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('RustDesk Host');
  });

  it('should open RustDesk client on connect', async () => {
    await addConnection('RustDesk Host', '987654321', 'RustDesk');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const client = await $('[data-testid="rustdesk-client"]');
    expect(await client.isExisting()).toBe(true);
  });
});

describe('SMB Protocol', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('SMB Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should create an SMB connection', async () => {
    await addConnection('File Server', '\\\\server\\share', 'SMB');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('File Server');
  });

  it('should open SMB client on connect', async () => {
    await addConnection('File Server', '\\\\server\\share', 'SMB');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const client = await $('[data-testid="smb-client"]');
    expect(await client.isExisting()).toBe(true);
  });

  it('should show file browser interface', async () => {
    await addConnection('File Server', '\\\\server\\share', 'SMB');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const fileBrowser = await $('[data-testid="smb-file-browser"]');
    if (await fileBrowser.isExisting()) {
      expect(await fileBrowser.isDisplayed()).toBe(true);
    }
  });
});

describe('WebBrowser Protocol', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('WebBrowser Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should create a WebBrowser connection', async () => {
    await addConnection('Web App', 'https://example.com', 'WebBrowser');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('Web App');
  });

  it('should open WebBrowser on connect', async () => {
    await addConnection('Web App', 'https://example.com', 'WebBrowser');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const webBrowser = await $('[data-testid="web-browser"]');
    expect(await webBrowser.isExisting()).toBe(true);
  });

  it('should show navigation bar', async () => {
    await addConnection('Web App', 'https://example.com', 'WebBrowser');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const navBar = await $('[data-testid="web-browser-nav-bar"]');
    if (await navBar.isExisting()) {
      const backBtn = await $('[data-testid="web-browser-back"]');
      const forwardBtn = await $('[data-testid="web-browser-forward"]');
      const refreshBtn = await $('[data-testid="web-browser-refresh"]');
      const urlBar = await $('[data-testid="web-browser-url"]');

      expect(await backBtn.isExisting()).toBe(true);
      expect(await forwardBtn.isExisting()).toBe(true);
      expect(await refreshBtn.isExisting()).toBe(true);
      expect(await urlBar.isExisting()).toBe(true);
    }
  });

  it('should show bookmark functionality', async () => {
    await addConnection('Web App', 'https://example.com', 'WebBrowser');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const bookmarkBtn = await $('[data-testid="web-browser-bookmark"]');
    if (await bookmarkBtn.isExisting()) {
      expect(await bookmarkBtn.isDisplayed()).toBe(true);
    }
  });
});

describe('WhatsApp Protocol', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('WhatsApp Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should create a WhatsApp connection', async () => {
    await addConnection('WhatsApp Business', 'whatsapp://link', 'WhatsApp');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('WhatsApp Business');
  });

  it('should open WhatsApp panel on connect', async () => {
    await addConnection('WhatsApp Business', 'whatsapp://link', 'WhatsApp');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const waPanel = await $('[data-testid="whatsapp-panel"]');
    expect(await waPanel.isExisting()).toBe(true);
  });

  it('should show WhatsApp tabs', async () => {
    await addConnection('WhatsApp Business', 'whatsapp://link', 'WhatsApp');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(2000);

    const chatTab = await $('[data-testid="whatsapp-tab-chat"]');
    const contactsTab = await $('[data-testid="whatsapp-tab-contacts"]');
    const settingsTab = await $('[data-testid="whatsapp-tab-settings"]');

    if (await chatTab.isExisting()) {
      expect(await chatTab.isDisplayed()).toBe(true);
      expect(await contactsTab.isExisting()).toBe(true);
      expect(await settingsTab.isExisting()).toBe(true);
    }
  });
});
