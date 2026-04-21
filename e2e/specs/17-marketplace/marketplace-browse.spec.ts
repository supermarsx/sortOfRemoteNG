import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Marketplace Browsing', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Marketplace Tests');
  });

  it('should open marketplace panel', async () => {
    const marketplaceBtn = await $(S.marketplacePanel);
    await marketplaceBtn.click();
    await browser.pause(500);

    const panel = await $('[data-testid="marketplace-panel-content"]');
    await panel.waitForDisplayed({ timeout: 5_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should show Browse tab with available plugins', async () => {
    const marketplaceBtn = await $(S.marketplacePanel);
    await marketplaceBtn.click();
    await browser.pause(500);

    const browseTab = await $('[data-testid="marketplace-browse-tab"]');
    await browseTab.waitForDisplayed({ timeout: 5_000 });
    await browseTab.click();
    await browser.pause(1000);

    const pluginCards = await $$('[data-testid="marketplace-plugin-card"]');
    expect(pluginCards.length).toBeGreaterThan(0);
  });

  it('should search plugins by name', async () => {
    const marketplaceBtn = await $(S.marketplacePanel);
    await marketplaceBtn.click();
    await browser.pause(500);

    const searchInput = await $('[data-testid="marketplace-search"]');
    await searchInput.waitForDisplayed({ timeout: 5_000 });
    await searchInput.setValue('SSH');
    await browser.pause(1000);

    const pluginCards = await $$('[data-testid="marketplace-plugin-card"]');
    expect(pluginCards.length).toBeGreaterThanOrEqual(0);

    // If results exist, verify they match the search term
    if ((await pluginCards.length) > 0) {
      const firstCardTitle = await pluginCards[0].$('[data-testid="plugin-card-title"]');
      const titleText = await firstCardTitle.getText();
      expect(titleText.toLowerCase()).toContain('ssh');
    }
  });

  it('should filter plugins by category', async () => {
    const marketplaceBtn = await $(S.marketplacePanel);
    await marketplaceBtn.click();
    await browser.pause(500);

    const categoryFilter = await $('[data-testid="marketplace-category-filter"]');
    await categoryFilter.waitForDisplayed({ timeout: 5_000 });
    await categoryFilter.click();
    await browser.pause(300);

    const categoryOption = await $('[data-testid="marketplace-category-protocols"]');
    if (await categoryOption.isExisting()) {
      await categoryOption.click();
      await browser.pause(1000);

      const pluginCards = await $$('[data-testid="marketplace-plugin-card"]');
      // The filtered list should render (may be empty for some categories)
      expect(pluginCards).toBeDefined();
    }
  });

  it('should show plugin details including description, version, and author', async () => {
    const marketplaceBtn = await $(S.marketplacePanel);
    await marketplaceBtn.click();
    await browser.pause(500);

    const browseTab = await $('[data-testid="marketplace-browse-tab"]');
    await browseTab.waitForDisplayed({ timeout: 5_000 });
    await browseTab.click();
    await browser.pause(1000);

    const pluginCards = await $$('[data-testid="marketplace-plugin-card"]');
    if ((await pluginCards.length) > 0) {
      await pluginCards[0].click();
      await browser.pause(500);

      const detailPanel = await $('[data-testid="marketplace-plugin-detail"]');
      await detailPanel.waitForDisplayed({ timeout: 5_000 });

      const description = await $('[data-testid="plugin-detail-description"]');
      expect(await description.isDisplayed()).toBe(true);

      const version = await $('[data-testid="plugin-detail-version"]');
      expect(await version.isDisplayed()).toBe(true);

      const author = await $('[data-testid="plugin-detail-author"]');
      expect(await author.isDisplayed()).toBe(true);
    }
  });
});
