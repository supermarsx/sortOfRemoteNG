import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

async function addConnection(
  name: string,
  hostname: string,
  protocol: string,
  port?: string,
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

  if (port) {
    const portInput = await $(S.editorPort);
    await portInput.clearValue();
    await portInput.setValue(port);
  }

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

describe('Connection Creation', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should open editor when clicking Add Connection', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    expect(await editor.isDisplayed()).toBe(true);
  });

  it('should create an SSH connection with basic fields', async () => {
    await addConnection('Dev Server', '192.168.1.10', 'SSH', '22');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('Dev Server');
  });

  it('should create an RDP connection with all basic fields', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const nameInput = await $(S.editorName);
    await nameInput.setValue('Windows Box');

    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('10.0.0.50');

    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('RDP');

    const portInput = await $(S.editorPort);
    await portInput.clearValue();
    await portInput.setValue('3389');

    const usernameInput = await $(S.editorUsername);
    await usernameInput.setValue('admin');

    const passwordInput = await $(S.editorPassword);
    await passwordInput.setValue('secret');

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('Windows Box');
  });

  it('should create an HTTP connection with URL', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const nameInput = await $(S.editorName);
    await nameInput.setValue('Web Dashboard');

    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('https://dashboard.example.com');

    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('HTTP');

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('Web Dashboard');
  });

  it('should create a connection inside a group', async () => {
    // First create a group
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const nameInput = await $(S.editorName);
    await nameInput.setValue('Grouped Server');

    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('10.0.0.1');

    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('SSH');

    const parentFolder = await $(S.editorParentFolder);
    if (await parentFolder.isExisting()) {
      await parentFolder.selectByVisibleText('Production');
    }

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const groups = await $$(S.connectionGroup);
    const groupTexts = await groups.map((g) => g.getText());
    const hasGroupedChild = groupTexts.some((text) => text.includes('Grouped Server'));
    expect(hasGroupedChild).toBe(true);
  });

  it('should reject an empty name', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    // Leave name empty, fill other fields
    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('192.168.1.1');

    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('SSH');

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(300);

    // Editor should still be open — save was rejected
    expect(await editor.isDisplayed()).toBe(true);

    // Validation error should be visible on name field
    const nameInput = await $(S.editorName);
    const isInvalid =
      (await nameInput.getAttribute('aria-invalid')) === 'true' ||
      (await nameInput.getCSSProperty('border-color')).parsed?.hex === '#ff0000';
    expect(isInvalid).toBe(true);
  });

  it('should reject an invalid port number', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const nameInput = await $(S.editorName);
    await nameInput.setValue('Bad Port');

    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('10.0.0.1');

    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('SSH');

    // Try port 0
    const portInput = await $(S.editorPort);
    await portInput.clearValue();
    await portInput.setValue('0');

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(300);
    expect(await editor.isDisplayed()).toBe(true);

    // Try port > 65535
    await portInput.clearValue();
    await portInput.setValue('70000');
    await saveBtn.click();
    await browser.pause(300);
    expect(await editor.isDisplayed()).toBe(true);
  });

  it('should auto-fill default port when protocol is selected', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const protocolSelect = await $(S.editorProtocol);
    const portInput = await $(S.editorPort);

    // SSH → 22
    await protocolSelect.selectByVisibleText('SSH');
    await browser.pause(200);
    expect(await portInput.getValue()).toBe('22');

    // RDP → 3389
    await protocolSelect.selectByVisibleText('RDP');
    await browser.pause(200);
    expect(await portInput.getValue()).toBe('3389');

    // VNC → 5900
    await protocolSelect.selectByVisibleText('VNC');
    await browser.pause(200);
    expect(await portInput.getValue()).toBe('5900');
  });
});
