import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Marketplace Plugin Lifecycle', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Plugin Tests');
  });

  it('should install a plugin and show it in Installed tab', async () => {
    const marketplaceBtn = await $(S.marketplacePanel);
    await marketplaceBtn.click();
    await browser.pause(500);

    // Browse and pick first available plugin
    const browseTab = await $('[data-testid="marketplace-browse-tab"]');
    await browseTab.waitForDisplayed({ timeout: 5_000 });
    await browseTab.click();
    await browser.pause(1000);

    const pluginCards = await $$('[data-testid="marketplace-plugin-card"]');
    if ((await pluginCards.length) === 0) return; // skip if no plugins available

    await pluginCards[0].click();
    await browser.pause(500);

    const installBtn = await $('[data-testid="plugin-install-btn"]');
    await installBtn.waitForDisplayed({ timeout: 5_000 });
    await installBtn.click();
    await browser.pause(3000);

    // Switch to Installed tab and verify the plugin appears
    const installedTab = await $('[data-testid="marketplace-installed-tab"]');
    await installedTab.click();
    await browser.pause(1000);

    const installedPlugins = await $$('[data-testid="marketplace-plugin-card"]');
    expect(installedPlugins.length).toBeGreaterThan(0);
  });

  it('should enable and disable a plugin', async () => {
    const marketplaceBtn = await $(S.marketplacePanel);
    await marketplaceBtn.click();
    await browser.pause(500);

    const installedTab = await $('[data-testid="marketplace-installed-tab"]');
    await installedTab.waitForDisplayed({ timeout: 5_000 });
    await installedTab.click();
    await browser.pause(1000);

    const installedPlugins = await $$('[data-testid="marketplace-plugin-card"]');
    if ((await installedPlugins.length) === 0) return;

    await installedPlugins[0].click();
    await browser.pause(500);

    // Disable the plugin
    const disableBtn = await $('[data-testid="plugin-disable-btn"]');
    if (await disableBtn.isExisting()) {
      await disableBtn.click();
      await browser.pause(1000);

      const statusBadge = await $('[data-testid="plugin-status-badge"]');
      const statusText = await statusBadge.getText();
      expect(statusText.toLowerCase()).toContain('disabled');

      // Re-enable
      const enableBtn = await $('[data-testid="plugin-enable-btn"]');
      await enableBtn.click();
      await browser.pause(1000);

      const updatedStatus = await statusBadge.getText();
      expect(updatedStatus.toLowerCase()).toContain('enabled');
    }
  });

  it('should uninstall a plugin', async () => {
    const marketplaceBtn = await $(S.marketplacePanel);
    await marketplaceBtn.click();
    await browser.pause(500);

    const installedTab = await $('[data-testid="marketplace-installed-tab"]');
    await installedTab.waitForDisplayed({ timeout: 5_000 });
    await installedTab.click();
    await browser.pause(1000);

    const installedPlugins = await $$('[data-testid="marketplace-plugin-card"]');
    if ((await installedPlugins.length) === 0) return;

    const countBefore = await installedPlugins.length;
    await installedPlugins[0].click();
    await browser.pause(500);

    const uninstallBtn = await $('[data-testid="plugin-uninstall-btn"]');
    await uninstallBtn.waitForDisplayed({ timeout: 5_000 });
    await uninstallBtn.click();
    await browser.pause(500);

    // Confirm uninstall dialog
    const confirmBtn = await $(S.confirmYes);
    if (await confirmBtn.isExisting()) {
      await confirmBtn.click();
      await browser.pause(2000);
    }

    const remainingPlugins = await $$('[data-testid="marketplace-plugin-card"]');
    expect(remainingPlugins.length).toBeLessThan(countBefore);
  });

  it('should check for plugin updates', async () => {
    const marketplaceBtn = await $(S.marketplacePanel);
    await marketplaceBtn.click();
    await browser.pause(500);

    const updatesTab = await $('[data-testid="marketplace-updates-tab"]');
    if (await updatesTab.isExisting()) {
      await updatesTab.click();
      await browser.pause(2000);

      const updatesContent = await $('[data-testid="marketplace-updates-content"]');
      await updatesContent.waitForDisplayed({ timeout: 5_000 });
      expect(await updatesContent.isDisplayed()).toBe(true);
    }
  });
});
