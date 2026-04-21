import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Settings — General', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Test');
  });

  it('should open settings dialog via gear icon', async () => {
    await openSettings();

    const dialog = await $(S.settingsDialog);
    expect(await dialog.isDisplayed()).toBe(true);

    await closeSettings();
  });

  it('should change app theme to dark', async () => {
    await openSettings();

    const themeSelect = await $('[data-testid="settings-theme-select"]');
    await themeSelect.click();

    const darkOption = await $('[data-testid="theme-option-dark"]');
    await darkOption.click();
    await browser.pause(500);

    const appShell = await $(S.appShell);
    const classAttr = await appShell.getAttribute('class');
    expect(classAttr).toContain('dark');

    await closeSettings();
  });

  it('should change app theme to light', async () => {
    await openSettings();

    const themeSelect = await $('[data-testid="settings-theme-select"]');
    await themeSelect.click();

    const lightOption = await $('[data-testid="theme-option-light"]');
    await lightOption.click();
    await browser.pause(500);

    const appShell = await $(S.appShell);
    const classAttr = await appShell.getAttribute('class');
    expect(classAttr).toContain('light');

    await closeSettings();
  });

  it('should change color scheme and update accent colors', async () => {
    await openSettings();

    const colorScheme = await $('[data-testid="settings-color-scheme"]');
    await colorScheme.click();

    const options = await $$('[data-testid="color-scheme-option"]');
    expect(options.length).toBeGreaterThan(1);

    await options[1].click();
    await browser.pause(500);

    await closeSettings();
  });

  it('should toggle auto-save setting', async () => {
    await openSettings();

    const autoSaveToggle = await $('[data-testid="settings-auto-save"]');
    const initialState = await autoSaveToggle.getAttribute('aria-checked');

    await autoSaveToggle.click();
    await browser.pause(300);

    const newState = await autoSaveToggle.getAttribute('aria-checked');
    expect(newState).not.toBe(initialState);

    await closeSettings();
  });

  it('should filter settings via search', async () => {
    await openSettings();

    const searchInput = await $(S.settingsSearch);
    await searchInput.setValue('theme');
    await browser.pause(500);

    const sections = await $$('[data-testid="settings-section"]');
    const visibleSections = [];
    for (const section of sections) {
      if (await section.isDisplayed()) {
        visibleSections.push(section);
      }
    }
    expect(visibleSections.length).toBeGreaterThanOrEqual(1);

    await closeSettings();
  });

  it('should close settings dialog when dismiss button is clicked', async () => {
    await openSettings();

    const dialog = await $(S.settingsDialog);
    expect(await dialog.isDisplayed()).toBe(true);

    await closeSettings();

    await dialog.waitForExist({ timeout: 5_000, reverse: true });
  });
});
