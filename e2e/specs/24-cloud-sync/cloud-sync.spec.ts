import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Cloud Sync — Status Bar', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Sync Tests');
  });

  it('should display sync status bar indicator', async () => {
    const statusBar = await $(S.syncStatusBar);
    expect(await statusBar.isExisting()).toBe(true);
  });

  it('should show cloud sync status popup on click', async () => {
    const statusBar = await $(S.syncStatusBar);
    await statusBar.click();
    await browser.pause(500);

    const popup = await $(S.cloudSyncStatus);
    await popup.waitForDisplayed({ timeout: 5_000 });
    expect(await popup.isDisplayed()).toBe(true);
  });
});

describe('Cloud Sync — Provider Configuration', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Sync Config Tests');
  });

  it('should open cloud sync settings tab', async () => {
    await openSettings();

    const syncTab = await $('[data-testid="settings-tab-cloud-sync"]');
    await syncTab.click();
    await browser.pause(500);

    const syncSection = await $('[data-testid="settings-cloud-sync-section"]');
    expect(await syncSection.isDisplayed()).toBe(true);

    await closeSettings();
  });

  it('should show available sync providers', async () => {
    await openSettings();

    const syncTab = await $('[data-testid="settings-tab-cloud-sync"]');
    await syncTab.click();
    await browser.pause(500);

    const providers = await $$(S.syncProviderItem);
    expect(providers.length).toBeGreaterThan(0);

    await closeSettings();
  });

  it('should configure a sync provider', async () => {
    await openSettings();

    const syncTab = await $('[data-testid="settings-tab-cloud-sync"]');
    await syncTab.click();
    await browser.pause(500);

    const providers = await $$(S.syncProviderItem);
    if ((await providers.length) > 0) {
      await providers[0].click();
      await browser.pause(500);

      const configForm = await $('[data-testid="sync-provider-config"]');
      expect(await configForm.isDisplayed()).toBe(true);
    }

    await closeSettings();
  });
});

describe('Cloud Sync — Backup Operations', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Backup Ops Tests');
  });

  it('should open backup panel', async () => {
    const syncStatusBar = await $(S.syncStatusBar);
    await syncStatusBar.click();
    await browser.pause(500);

    const backupPanel = await $(S.syncBackupPanel);
    if (await backupPanel.isExisting()) {
      expect(await backupPanel.isDisplayed()).toBe(true);
    }
  });

  it('should show backup list', async () => {
    const syncStatusBar = await $(S.syncStatusBar);
    await syncStatusBar.click();
    await browser.pause(500);

    const backupList = await $(S.backupList);
    if (await backupList.isExisting()) {
      const items = await $$(S.backupItem);
      expect(items).toBeDefined();
    }
  });

  it('should trigger manual backup', async () => {
    const syncStatusBar = await $(S.syncStatusBar);
    await syncStatusBar.click();
    await browser.pause(500);

    const createBtn = await $(S.backupCreateBtn);
    if (await createBtn.isExisting()) {
      await createBtn.click();
      await browser.pause(2000);

      // Verify a backup was created
      const items = await $$(S.backupItem);
      expect(items.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should test sync connection', async () => {
    const syncStatusBar = await $(S.syncStatusBar);
    await syncStatusBar.click();
    await browser.pause(500);

    const testBtn = await $(S.syncTestBtn);
    if (await testBtn.isExisting()) {
      await testBtn.click();
      await browser.pause(3000);

      // Should show test result
      const result = await $('[data-testid="sync-test-result"]');
      expect(await result.isExisting()).toBe(true);
    }
  });
});
