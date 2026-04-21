import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';

async function addAndOpenConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('SSH');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);

  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(name)) {
      await item.doubleClick();
      await browser.pause(1_000);
      return;
    }
  }
}

describe('Session Layouts', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Layout Tests');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should default to tab layout', async () => {
    await addAndOpenConnection('Server A');

    const tabBar = await $(S.sessionTabs);
    expect(await tabBar.isDisplayed()).toBe(true);
  });

  it('should switch to vertical split layout with two panels side by side', async () => {
    await addAndOpenConnection('Server A');
    await addAndOpenConnection('Server B');

    const layoutSelector = await $('[data-testid="layout-selector"]');
    await layoutSelector.click();

    const verticalOption = await $('[data-testid="layout-vertical-split"]');
    await verticalOption.click();
    await browser.pause(500);

    const panels = await $$('[data-testid="session-panel"]');
    expect(panels.length).toBe(2);
  });

  it('should switch to horizontal split layout with panels stacked', async () => {
    await addAndOpenConnection('Server A');
    await addAndOpenConnection('Server B');

    const layoutSelector = await $('[data-testid="layout-selector"]');
    await layoutSelector.click();

    const horizontalOption = await $('[data-testid="layout-horizontal-split"]');
    await horizontalOption.click();
    await browser.pause(500);

    const panels = await $$('[data-testid="session-panel"]');
    expect(panels.length).toBe(2);
  });

  it('should support 2x2 grid layout', async () => {
    await addAndOpenConnection('Server A');
    await addAndOpenConnection('Server B');
    await addAndOpenConnection('Server C');
    await addAndOpenConnection('Server D');

    const layoutSelector = await $('[data-testid="layout-selector"]');
    await layoutSelector.click();

    const gridOption = await $('[data-testid="layout-grid-2x2"]');
    await gridOption.click();
    await browser.pause(500);

    const panels = await $$('[data-testid="session-panel"]');
    expect(panels.length).toBe(4);
  });

  it('should persist layout after switching tabs', async () => {
    await addAndOpenConnection('Server A');
    await addAndOpenConnection('Server B');

    const layoutSelector = await $('[data-testid="layout-selector"]');
    await layoutSelector.click();

    const verticalOption = await $('[data-testid="layout-vertical-split"]');
    await verticalOption.click();
    await browser.pause(500);

    // Switch to tab view and back
    const tabs = await $$(S.sessionTab);
    await tabs[0].click();
    await browser.pause(300);
    await tabs[1].click();
    await browser.pause(300);

    const panels = await $$('[data-testid="session-panel"]');
    expect(panels.length).toBe(2);
  });
});
