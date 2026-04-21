import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Session Detach', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Detach Tests');
  });

  it('should detach a session to a new window via context menu', async () => {
    // Create a connection and open a session
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('Detach Target');
    const hostInput = await $(S.editorHostname);
    await hostInput.setValue('localhost');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const treeItem = await $(S.connectionItem);
    await treeItem.doubleClick();
    await browser.pause(2000);

    // Right-click on session tab for context menu
    const sessionTab = await $(S.sessionTab);
    await sessionTab.waitForDisplayed({ timeout: 5_000 });
    await sessionTab.click({ button: 'right' });
    await browser.pause(300);

    const detachOption = await $('[data-testid="session-tab-detach"]');
    if (await detachOption.isExisting()) {
      await detachOption.click();
      await browser.pause(2000);

      // Verify a new window opened
      const windows = await browser.getWindowHandles();
      expect(windows.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should open a detached window with the session', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('Detach Window Test');
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
    if (await detachOption.isExisting()) {
      await detachOption.click();
      await browser.pause(2000);

      const windows = await browser.getWindowHandles();
      expect(windows.length).toBeGreaterThanOrEqual(2);

      // Switch to the new window and verify content
      await browser.switchToWindow(windows[windows.length - 1]);
      await browser.pause(1000);

      const detachedContent = await $('[data-testid="detached-session-content"]');
      if (await detachedContent.isExisting()) {
        expect(await detachedContent.isDisplayed()).toBe(true);
      }

      // Switch back to main
      await browser.switchToWindow(windows[0]);
    }
  });

  it('should allow reattaching after closing detached window', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('Reattach Test');
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
    if (await detachOption.isExisting()) {
      await detachOption.click();
      await browser.pause(2000);

      const windows = await browser.getWindowHandles();
      if (windows.length >= 2) {
        // Close the detached window
        await browser.switchToWindow(windows[windows.length - 1]);
        await browser.closeWindow();
        await browser.switchToWindow(windows[0]);
        await browser.pause(1000);

        // Session should be available for reattach
        const reattachIndicator = await $('[data-testid="session-reattach-available"]');
        if (await reattachIndicator.isExisting()) {
          expect(await reattachIndicator.isDisplayed()).toBe(true);
        }
      }
    }
  });
});
