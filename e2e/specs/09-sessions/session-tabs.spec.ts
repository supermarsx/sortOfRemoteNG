import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';

async function addConnection(name: string, protocol = 'SSH'): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText(protocol);

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function openSession(connectionName: string): Promise<void> {
  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(connectionName)) {
      await item.doubleClick();
      await browser.pause(1_000);
      return;
    }
  }
  throw new Error(`Connection "${connectionName}" not found in tree`);
}

describe('Session Tabs', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Tab Tests');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should show tabs in tab bar when multiple sessions are opened', async () => {
    await addConnection('Server A');
    await addConnection('Server B');
    await openSession('Server A');
    await openSession('Server B');

    const tabs = await $$(S.sessionTab);
    expect(tabs.length).toBeGreaterThanOrEqual(2);
  });

  it('should switch active session when clicking a tab', async () => {
    await addConnection('Server A');
    await addConnection('Server B');
    await openSession('Server A');
    await openSession('Server B');

    const tabs = await $$(S.sessionTab);
    await tabs[0].click();
    await browser.pause(500);

    const activeTab = await $('[data-testid="session-tab-active"]');
    const activeText = await activeTab.getText();
    expect(activeText).toContain('Server A');
  });

  it('should close tab and disconnect session when clicking close button', async () => {
    await addConnection('Server A');
    await openSession('Server A');

    let tabs = await $$(S.sessionTab);
    expect(tabs.length).toBe(1);

    const closeBtn = await tabs[0].$('[data-testid="session-tab-close"]');
    await closeBtn.click();
    await browser.pause(500);

    tabs = await $$(S.sessionTab);
    expect(tabs.length).toBe(0);
  });

  it('should close tab on middle-click', async () => {
    await addConnection('Server A');
    await openSession('Server A');

    let tabs = await $$(S.sessionTab);
    expect(tabs.length).toBe(1);

    await tabs[0].click({ button: 'middle' });
    await browser.pause(500);

    tabs = await $$(S.sessionTab);
    expect(tabs.length).toBe(0);
  });

  it('should display connection name and status indicator on each tab', async () => {
    await addConnection('Server A');
    await openSession('Server A');

    const tab = await $(S.sessionTab);
    const text = await tab.getText();
    expect(text).toContain('Server A');

    const indicator = await tab.$('[data-testid="session-tab-status"]');
    expect(await indicator.isExisting()).toBe(true);
  });

  it('should highlight the active tab differently from inactive tabs', async () => {
    await addConnection('Server A');
    await addConnection('Server B');
    await openSession('Server A');
    await openSession('Server B');

    const activeTab = await $('[data-testid="session-tab-active"]');
    expect(await activeTab.isExisting()).toBe(true);

    const tabs = await $$(S.sessionTab);
    const inactiveCount = (await tabs.length) - 1;
    expect(inactiveCount).toBeGreaterThanOrEqual(1);
  });
});
