import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Proxy Chains', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Proxy Tests');
  });

  it('should create a proxy profile', async () => {
    const proxyBtn = await $('[data-testid="open-proxy-manager"]');
    await proxyBtn.click();
    await browser.pause(500);

    const addProxyBtn = await $('[data-testid="proxy-add"]');
    await addProxyBtn.click();

    const nameInput = await $('[data-testid="proxy-name"]');
    await nameInput.setValue('Test Proxy');

    const hostInput = await $('[data-testid="proxy-host"]');
    await hostInput.setValue('proxy.example.com');

    const portInput = await $('[data-testid="proxy-port"]');
    await portInput.setValue('8080');

    const saveBtn = await $('[data-testid="proxy-save"]');
    await saveBtn.click();
    await browser.pause(500);

    const items = await $$('[data-testid="proxy-item"]');
    const names = await items.map((i) => i.getText());
    expect(names).toContain('Test Proxy');
  });

  it('should create a proxy chain', async () => {
    const proxyBtn = await $('[data-testid="open-proxy-manager"]');
    await proxyBtn.click();
    await browser.pause(500);

    // Create two proxies first
    for (const proxyName of ['Proxy A', 'Proxy B']) {
      const addProxyBtn = await $('[data-testid="proxy-add"]');
      await addProxyBtn.click();
      const nameInput = await $('[data-testid="proxy-name"]');
      await nameInput.setValue(proxyName);
      const hostInput = await $('[data-testid="proxy-host"]');
      await hostInput.setValue('proxy.example.com');
      const portInput = await $('[data-testid="proxy-port"]');
      await portInput.setValue('8080');
      const saveBtn = await $('[data-testid="proxy-save"]');
      await saveBtn.click();
      await browser.pause(500);
    }

    const chainBtn = await $('[data-testid="proxy-chain-create"]');
    await chainBtn.click();
    await browser.pause(500);

    const chainPanel = await $('[data-testid="proxy-chain-panel"]');
    expect(await chainPanel.isDisplayed()).toBe(true);
  });

  it('should associate proxy with a connection', async () => {
    // Create a proxy first
    const proxyBtn = await $('[data-testid="open-proxy-manager"]');
    await proxyBtn.click();
    await browser.pause(500);

    const addProxyBtn = await $('[data-testid="proxy-add"]');
    await addProxyBtn.click();
    const nameInput = await $('[data-testid="proxy-name"]');
    await nameInput.setValue('Connection Proxy');
    const hostInput = await $('[data-testid="proxy-host"]');
    await hostInput.setValue('proxy.example.com');
    const portInput = await $('[data-testid="proxy-port"]');
    await portInput.setValue('8080');
    const saveBtn = await $('[data-testid="proxy-save"]');
    await saveBtn.click();
    await browser.pause(500);

    // Close proxy manager, create a connection
    const closeBtn = await $(S.modalClose);
    await closeBtn.click();
    await browser.pause(300);

    const addConnBtn = await $(S.toolbarNewConnection);
    await addConnBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const connName = await $(S.editorName);
    await connName.setValue('Proxied Server');
    const hostname = await $(S.editorHostname);
    await hostname.setValue('10.0.0.1');
    const protocol = await $(S.editorProtocol);
    await protocol.selectByVisibleText('SSH');

    const proxySelect = await $('[data-testid="editor-proxy-select"]');
    await proxySelect.click();
    const proxyOption = await $('[data-testid="proxy-option-connection-proxy"]');
    await proxyOption.click();

    const connSaveBtn = await $(S.editorSave);
    await connSaveBtn.click();
    await browser.pause(500);
  });
});
