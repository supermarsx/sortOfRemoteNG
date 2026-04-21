import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Settings — Backup', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Backup Settings');
    await openSettings();
  });

  afterEach(async () => {
    await closeSettings();
  });

  it('should configure backup settings', async () => {
    const backupSection = await $('[data-testid="settings-backup-section"]');
    expect(await backupSection.isExisting()).toBe(true);

    const enableBackup = await $('[data-testid="settings-backup-enable"]');
    await enableBackup.click();
    await browser.pause(300);

    const pathInput = await $('[data-testid="settings-backup-path"]');
    expect(await pathInput.isExisting()).toBe(true);
  });

  it('should trigger backup and verify it is initiated', async () => {
    const backupNowBtn = await $('[data-testid="settings-backup-now"]');
    await backupNowBtn.click();
    await browser.pause(1_000);

    const statusIndicator = await $('[data-testid="backup-status"]');
    const statusText = await statusIndicator.getText();
    expect(statusText.length).toBeGreaterThan(0);
  });

  it('should configure backup encryption settings', async () => {
    const encryptToggle = await $('[data-testid="settings-backup-encrypt"]');
    const initial = await encryptToggle.getAttribute('aria-checked');

    await encryptToggle.click();
    await browser.pause(300);

    const updated = await encryptToggle.getAttribute('aria-checked');
    expect(updated).not.toBe(initial);
  });
});
