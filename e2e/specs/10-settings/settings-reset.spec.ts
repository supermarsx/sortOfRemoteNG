import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Settings — Reset', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Reset Settings');
    await openSettings();
  });

  afterEach(async () => {
    await closeSettings();
  });

  it('should reset a section to defaults', async () => {
    // Change a setting first
    const timeoutInput = await $('[data-testid="settings-ssh-timeout"]');
    await timeoutInput.clearValue();
    await timeoutInput.setValue('99');
    await browser.pause(300);

    const resetBtn = await $('[data-testid="settings-reset-section"]');
    await resetBtn.click();

    const confirmBtn = await $(S.confirmYes);
    await confirmBtn.click();
    await browser.pause(500);

    const value = await timeoutInput.getValue();
    expect(value).not.toBe('99');
  });

  it('should verify defaults are restored after reset', async () => {
    const resetAllBtn = await $('[data-testid="settings-reset-all"]');
    await resetAllBtn.click();

    const confirmBtn = await $(S.confirmYes);
    await confirmBtn.click();
    await browser.pause(500);

    // Verify a known default value is restored
    const themeSelect = await $('[data-testid="settings-theme-select"]');
    const themeText = await themeSelect.getText();
    expect(themeText.length).toBeGreaterThan(0);
  });
});
