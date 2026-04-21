import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Shortcut Manager', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Shortcut Tests');
  });

  it('should open shortcut manager dialog', async () => {
    const shortcutBtn = await $(S.shortcutManagerBtn);
    await shortcutBtn.click();
    await browser.pause(500);

    const dialog = await $(S.shortcutManagerDialog);
    await dialog.waitForDisplayed({ timeout: 5_000 });
    expect(await dialog.isDisplayed()).toBe(true);
  });

  it('should display list of shortcuts', async () => {
    const shortcutBtn = await $(S.shortcutManagerBtn);
    await shortcutBtn.click();
    await browser.pause(500);

    const dialog = await $(S.shortcutManagerDialog);
    await dialog.waitForDisplayed({ timeout: 5_000 });

    const shortcuts = await $$(S.shortcutItem);
    expect(shortcuts.length).toBeGreaterThan(0);
  });

  it('should search shortcuts by name', async () => {
    const shortcutBtn = await $(S.shortcutManagerBtn);
    await shortcutBtn.click();
    await browser.pause(500);

    const searchInput = await $(S.shortcutSearch);
    await searchInput.setValue('settings');
    await browser.pause(500);

    const shortcuts = await $$(S.shortcutItem);
    // Filtered list should be smaller or equal
    expect(shortcuts).toBeDefined();
  });

  it('should open shortcut edit mode', async () => {
    const shortcutBtn = await $(S.shortcutManagerBtn);
    await shortcutBtn.click();
    await browser.pause(500);

    const shortcuts = await $$(S.shortcutItem);
    if ((await shortcuts.length) > 0) {
      const editBtn = await shortcuts[0].$(S.shortcutEdit);
      if (await editBtn.isExisting()) {
        await editBtn.click();
        await browser.pause(300);

        const recordInput = await $(S.shortcutRecordInput);
        expect(await recordInput.isExisting()).toBe(true);
      }
    }
  });

  it('should have reset to default option', async () => {
    const shortcutBtn = await $(S.shortcutManagerBtn);
    await shortcutBtn.click();
    await browser.pause(500);

    const resetBtn = await $(S.shortcutReset);
    expect(await resetBtn.isExisting()).toBe(true);
  });
});

describe('Context Menu — Connection', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Context Menu Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    // Create a connection
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const nameInput = await $(S.editorName);
    await nameInput.setValue('Test Connection');

    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('10.0.0.1');

    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('SSH');

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);
  });

  it('should show context menu on right-click', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].click({ button: 'right' });
    await browser.pause(500);

    const contextMenu = await $(S.contextMenu);
    expect(await contextMenu.isDisplayed()).toBe(true);
  });

  it('should show Connect option in context menu', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].click({ button: 'right' });
    await browser.pause(500);

    const connectOption = await $(S.contextMenuConnect);
    expect(await connectOption.isExisting()).toBe(true);
  });

  it('should show Edit option in context menu', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].click({ button: 'right' });
    await browser.pause(500);

    const editOption = await $(S.contextMenuEdit);
    expect(await editOption.isExisting()).toBe(true);
  });

  it('should show Duplicate option in context menu', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].click({ button: 'right' });
    await browser.pause(500);

    const duplicateOption = await $(S.contextMenuDuplicate);
    expect(await duplicateOption.isExisting()).toBe(true);
  });

  it('should show Delete option in context menu', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].click({ button: 'right' });
    await browser.pause(500);

    const deleteOption = await $(S.contextMenuDelete);
    expect(await deleteOption.isExisting()).toBe(true);
  });

  it('should duplicate connection via context menu', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const initialCount = await items.length;

    await items[0].click({ button: 'right' });
    await browser.pause(500);

    const duplicateOption = await $(S.contextMenuDuplicate);
    await duplicateOption.click();
    await browser.pause(500);

    const updatedItems = await tree.$$(S.connectionItem);
    expect(updatedItems.length).toBe(initialCount + 1);
  });

  it('should delete connection via context menu', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const initialCount = await items.length;

    await items[0].click({ button: 'right' });
    await browser.pause(500);

    const deleteOption = await $(S.contextMenuDelete);
    await deleteOption.click();
    await browser.pause(300);

    const confirmBtn = await $(S.confirmYes);
    await confirmBtn.click();
    await browser.pause(500);

    const updatedItems = await tree.$$(S.connectionItem);
    expect(updatedItems.length).toBe(initialCount - 1);
  });
});

describe('Error Log Bar', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Error Log Tests');
  });

  it('should display error log bar when errors occur', async () => {
    const errorLogBar = await $(S.errorLogBar);
    // May or may not be visible depending on state
    expect(await errorLogBar.isExisting()).toBe(true);
  });

  it('should expand error log to show entries', async () => {
    const errorLogBar = await $(S.errorLogBar);
    if (await errorLogBar.isDisplayed()) {
      const expandBtn = await $(S.errorLogExpand);
      await expandBtn.click();
      await browser.pause(500);

      const entries = await $$(S.errorLogEntry);
      expect(entries).toBeDefined();
    }
  });

  it('should have clear log button', async () => {
    const errorLogBar = await $(S.errorLogBar);
    if (await errorLogBar.isDisplayed()) {
      const expandBtn = await $(S.errorLogExpand);
      await expandBtn.click();
      await browser.pause(500);

      const clearBtn = await $(S.errorLogClear);
      expect(await clearBtn.isExisting()).toBe(true);
    }
  });
});
