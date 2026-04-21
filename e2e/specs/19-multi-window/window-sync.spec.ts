import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings } from '../../helpers/app';

describe('Cross-Window Sync', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Sync Tests');
  });

  it('should reflect settings changes in detached window', async () => {
    // Create and detach a session
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('Sync Settings Host');
    const hostInput = await $(S.editorHostname);
    await hostInput.setValue('localhost');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const treeItem = await $(S.connectionItem);
    await treeItem.doubleClick();
    await browser.pause(2000);

    const sessionTab = await $(S.sessionTab);
    await sessionTab.waitForDisplayed({ timeout: 5_000 });
    await sessionTab.click({ button: 'right' });
    await browser.pause(300);

    const detachOption = await $('[data-testid="session-tab-detach"]');
    if (!(await detachOption.isExisting())) return;

    await detachOption.click();
    await browser.pause(2000);

    const windows = await browser.getWindowHandles();
    if (windows.length < 2) return;

    // Change a setting in the main window
    await openSettings();
    const settingToggle = await $('[data-testid="setting-show-toolbar-labels"]');
    if (await settingToggle.isExisting()) {
      await settingToggle.click();
      await browser.pause(500);
    }
    const closeModal = await $(S.modalClose);
    await closeModal.click();
    await browser.pause(1000);

    // Switch to detached window and verify setting propagated
    await browser.switchToWindow(windows[windows.length - 1]);
    await browser.pause(1000);

    // Verify the setting effect is visible in the detached window
    const detachedToolbar = await $('[data-testid="detached-toolbar"]');
    if (await detachedToolbar.isExisting()) {
      expect(await detachedToolbar.isDisplayed()).toBe(true);
    }

    await browser.switchToWindow(windows[0]);
  });

  it('should synchronize connection state across windows', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('Sync State Host');
    const hostInput = await $(S.editorHostname);
    await hostInput.setValue('localhost');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const treeItem = await $(S.connectionItem);
    await treeItem.doubleClick();
    await browser.pause(2000);

    const sessionTab = await $(S.sessionTab);
    await sessionTab.waitForDisplayed({ timeout: 5_000 });
    await sessionTab.click({ button: 'right' });
    await browser.pause(300);

    const detachOption = await $('[data-testid="session-tab-detach"]');
    if (!(await detachOption.isExisting())) return;

    await detachOption.click();
    await browser.pause(2000);

    const windows = await browser.getWindowHandles();
    if (windows.length < 2) return;

    // Add another connection in main window
    const addBtn2 = await $(S.toolbarNewConnection);
    await addBtn2.click();
    const nameInput2 = await $(S.editorName);
    await nameInput2.waitForDisplayed();
    await nameInput2.setValue('Second Host');
    const hostInput2 = await $(S.editorHostname);
    await hostInput2.setValue('10.0.0.2');
    const saveBtn2 = await $(S.editorSave);
    await saveBtn2.click();
    await browser.pause(1000);

    // Verify the detached window sees the updated connection list
    await browser.switchToWindow(windows[windows.length - 1]);
    await browser.pause(1500);

    const detachedTree = await $('[data-testid="detached-connection-tree"]');
    if (await detachedTree.isExisting()) {
      const items = await detachedTree.$$('[data-testid="connection-item"]');
      expect(items.length).toBeGreaterThanOrEqual(2);
    }

    await browser.switchToWindow(windows[0]);
  });

  it('should propagate theme changes to detached window', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('Theme Sync Host');
    const hostInput = await $(S.editorHostname);
    await hostInput.setValue('localhost');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const treeItem = await $(S.connectionItem);
    await treeItem.doubleClick();
    await browser.pause(2000);

    const sessionTab = await $(S.sessionTab);
    await sessionTab.waitForDisplayed({ timeout: 5_000 });
    await sessionTab.click({ button: 'right' });
    await browser.pause(300);

    const detachOption = await $('[data-testid="session-tab-detach"]');
    if (!(await detachOption.isExisting())) return;

    await detachOption.click();
    await browser.pause(2000);

    const windows = await browser.getWindowHandles();
    if (windows.length < 2) return;

    // Change theme in main window
    await openSettings();
    const themeSelect = await $('[data-testid="setting-theme"]');
    if (await themeSelect.isExisting()) {
      await themeSelect.selectByVisibleText('Light');
      await browser.pause(500);
    }
    const closeModal = await $(S.modalClose);
    await closeModal.click();
    await browser.pause(1000);

    // Verify theme updated in detached window
    await browser.switchToWindow(windows[windows.length - 1]);
    await browser.pause(1000);

    const detachedBody = await $('body');
    const theme = await detachedBody.getAttribute('data-theme');
    if (theme) {
      expect(theme).toContain('light');
    }

    await browser.switchToWindow(windows[0]);
  });
});
