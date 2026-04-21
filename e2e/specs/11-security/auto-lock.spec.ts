import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Auto-Lock', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Auto-Lock Tests');
  });

  it('should configure auto-lock timeout', async () => {
    await openSettings();

    const timeoutInput = await $('[data-testid="settings-auto-lock-timeout"]');
    await timeoutInput.clearValue();
    await timeoutInput.setValue('5');
    await browser.pause(300);

    expect(await timeoutInput.getValue()).toBe('5');

    await closeSettings();
  });

  it('should lock app after inactivity period', async () => {
    await openSettings();

    // Set very short timeout for testing
    const timeoutInput = await $('[data-testid="settings-auto-lock-timeout"]');
    await timeoutInput.clearValue();
    await timeoutInput.setValue('1');
    await browser.pause(300);

    await closeSettings();

    // Wait for lock to engage (1 minute + buffer)
    await browser.pause(70_000);

    const lockScreen = await $('[data-testid="lock-screen"]');
    expect(await lockScreen.isDisplayed()).toBe(true);
  });

  it('should reset timer on user activity', async () => {
    await openSettings();

    const timeoutInput = await $('[data-testid="settings-auto-lock-timeout"]');
    await timeoutInput.clearValue();
    await timeoutInput.setValue('2');
    await browser.pause(300);

    await closeSettings();

    // Simulate activity after 30 seconds
    await browser.pause(30_000);
    await browser.keys('Escape');
    await browser.pause(30_000);

    // Should not be locked due to activity
    const lockScreen = await $('[data-testid="lock-screen"]');
    const isLocked = await lockScreen.isExisting();
    expect(isLocked).toBe(false);
  });
});
