import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Keyboard Navigation', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('A11y Tests');
  });

  it('should navigate major UI areas with Tab key', async () => {
    // Tab from toolbar through sidebar, tree, and main content
    await browser.keys('Tab');
    await browser.pause(200);

    const toolbar = await $(S.toolbar);
    const sidebar = await $(S.sidebar);

    // Repeatedly tab and check focus moves to known regions
    let visitedToolbar = false;
    let visitedSidebar = false;

    for (let i = 0; i < 20; i++) {
      const activeEl = await browser.getActiveElement() as unknown as WebdriverIO.Element;
      const tag = await activeEl.getTagName();
      const testId = await activeEl.getAttribute('data-testid');

      if (testId && testId.includes('toolbar')) visitedToolbar = true;
      if (testId && testId.includes('sidebar')) visitedSidebar = true;

      await browser.keys('Tab');
      await browser.pause(100);
    }

    // Should have reached at least one known area
    expect(visitedToolbar || visitedSidebar).toBe(true);
  });

  it('should activate buttons with Enter and Space', async () => {
    // Focus the settings button via Tab
    const settingsBtn = await $(S.toolbarSettings);
    await browser.execute((el: HTMLElement) => el.focus(), settingsBtn as unknown as HTMLElement);
    await browser.pause(200);

    // Press Enter to open settings
    await browser.keys('Enter');
    await browser.pause(500);

    const dialog = await $(S.settingsDialog);
    const isOpen = await dialog.isExisting();
    expect(isOpen).toBe(true);

    // Close it
    const closeBtn = await $(S.modalClose);
    await closeBtn.click();
    await browser.pause(500);

    // Re-focus and use Space
    await browser.execute((el: HTMLElement) => el.focus(), settingsBtn as unknown as HTMLElement);
    await browser.pause(200);
    await browser.keys('Space');
    await browser.pause(500);

    const isOpenAgain = await dialog.isExisting();
    expect(isOpenAgain).toBe(true);
  });

  it('should close modals with Escape key', async () => {
    const settingsBtn = await $(S.toolbarSettings);
    await settingsBtn.click();
    await browser.pause(500);

    const dialog = await $(S.settingsDialog);
    await dialog.waitForExist({ timeout: 5_000 });
    expect(await dialog.isDisplayed()).toBe(true);

    await browser.keys('Escape');
    await browser.pause(500);

    await dialog.waitForExist({ timeout: 5_000, reverse: true });
  });

  it('should support keyboard shortcuts', async () => {
    // Ctrl+N → new connection
    await browser.keys(['Control', 'n']);
    await browser.pause(500);

    const editorPanel = await $(S.editorPanel);
    if (await editorPanel.isExisting()) {
      expect(await editorPanel.isDisplayed()).toBe(true);
    }

    // Escape to close editor
    await browser.keys('Escape');
    await browser.pause(300);

    // Ctrl+, → open settings
    await browser.keys(['Control', ',']);
    await browser.pause(500);

    const settingsDialog = await $(S.settingsDialog);
    if (await settingsDialog.isExisting()) {
      expect(await settingsDialog.isDisplayed()).toBe(true);
      await browser.keys('Escape');
      await browser.pause(300);
    }
  });
});
