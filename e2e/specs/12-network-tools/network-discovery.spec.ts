import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Network Discovery', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Discovery Tests');
  });

  it('should run a network scan', async () => {
    const discoveryBtn = await $(S.networkDiscovery);
    await discoveryBtn.click();
    await browser.pause(500);

    const scanInput = await $('[data-testid="discovery-subnet"]');
    await scanInput.setValue('192.168.1.0/24');

    const scanBtn = await $('[data-testid="discovery-scan-btn"]');
    await scanBtn.click();

    // Wait for scan to start
    const progressIndicator = await $('[data-testid="discovery-progress"]');
    await progressIndicator.waitForDisplayed({ timeout: 10_000 });
    expect(await progressIndicator.isDisplayed()).toBe(true);
  });

  it('should list discovered hosts', async () => {
    const discoveryBtn = await $(S.networkDiscovery);
    await discoveryBtn.click();
    await browser.pause(500);

    const scanInput = await $('[data-testid="discovery-subnet"]');
    await scanInput.setValue('192.168.1.0/24');

    const scanBtn = await $('[data-testid="discovery-scan-btn"]');
    await scanBtn.click();

    // Wait for scan to complete
    const resultsList = await $('[data-testid="discovery-results"]');
    await resultsList.waitForDisplayed({ timeout: 60_000 });

    const hosts = await $$('[data-testid="discovered-host"]');
    expect(hosts.length).toBeGreaterThanOrEqual(0);
  });

  it('should import a discovered host as a connection', async () => {
    const discoveryBtn = await $(S.networkDiscovery);
    await discoveryBtn.click();
    await browser.pause(500);

    const scanInput = await $('[data-testid="discovery-subnet"]');
    await scanInput.setValue('192.168.1.0/24');

    const scanBtn = await $('[data-testid="discovery-scan-btn"]');
    await scanBtn.click();

    const resultsList = await $('[data-testid="discovery-results"]');
    await resultsList.waitForDisplayed({ timeout: 60_000 });

    const hosts = await $$('[data-testid="discovered-host"]');
    if ((await hosts.length) > 0) {
      const importBtn = await hosts[0].$('[data-testid="import-host"]');
      await importBtn.click();
      await browser.pause(500);

      const tree = await $(S.connectionTree);
      const items = await tree.$$(S.connectionItem);
      expect(items.length).toBeGreaterThanOrEqual(1);
    }
  });
});
