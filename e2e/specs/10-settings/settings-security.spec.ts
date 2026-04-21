import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Settings — Security', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Security Settings');
    await openSettings();
  });

  afterEach(async () => {
    await closeSettings();
  });

  it('should configure auto-lock timeout', async () => {
    const timeoutInput = await $('[data-testid="settings-auto-lock-timeout"]');
    await timeoutInput.clearValue();
    await timeoutInput.setValue('10');
    await browser.pause(300);

    expect(await timeoutInput.getValue()).toBe('10');
  });

  it('should configure SSH key generation settings', async () => {
    const keyGenSection = await $('[data-testid="settings-ssh-keygen"]');
    expect(await keyGenSection.isExisting()).toBe(true);

    const keyTypeSelect = await $('[data-testid="settings-ssh-key-type"]');
    await keyTypeSelect.click();

    const ed25519 = await $('[data-testid="key-type-ed25519"]');
    await ed25519.click();
    await browser.pause(300);
  });

  it('should configure trust center policies', async () => {
    const trustPolicy = await $('[data-testid="settings-trust-policy"]');
    await trustPolicy.click();

    const tofuOption = await $('[data-testid="trust-policy-tofu"]');
    expect(await tofuOption.isExisting()).toBe(true);

    const alwaysAskOption = await $('[data-testid="trust-policy-always-ask"]');
    expect(await alwaysAskOption.isExisting()).toBe(true);

    await tofuOption.click();
    await browser.pause(300);
  });
});
