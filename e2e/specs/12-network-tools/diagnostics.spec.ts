import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Diagnostics', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Diagnostic Tests');
  });

  it('should open diagnostics panel', async () => {
    const diagBtn = await $('[data-testid="open-diagnostics"]');
    await diagBtn.click();
    await browser.pause(500);

    const panel = await $('[data-testid="diagnostics-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should display ping and traceroute results', async () => {
    const diagBtn = await $('[data-testid="open-diagnostics"]');
    await diagBtn.click();
    await browser.pause(500);

    const targetInput = await $('[data-testid="diagnostics-target"]');
    await targetInput.setValue('127.0.0.1');

    const pingBtn = await $('[data-testid="diagnostics-ping"]');
    await pingBtn.click();

    const results = await $('[data-testid="diagnostics-results"]');
    await results.waitForDisplayed({ timeout: 15_000 });
    const text = await results.getText();
    expect(text.length).toBeGreaterThan(0);
  });

  it('should export diagnostic report', async () => {
    const diagBtn = await $('[data-testid="open-diagnostics"]');
    await diagBtn.click();
    await browser.pause(500);

    const targetInput = await $('[data-testid="diagnostics-target"]');
    await targetInput.setValue('127.0.0.1');

    const pingBtn = await $('[data-testid="diagnostics-ping"]');
    await pingBtn.click();

    const results = await $('[data-testid="diagnostics-results"]');
    await results.waitForDisplayed({ timeout: 15_000 });

    const exportBtn = await $('[data-testid="diagnostics-export"]');
    await exportBtn.click();
    await browser.pause(500);

    const exportNotification = await $('[data-testid="diagnostics-export-success"]');
    expect(await exportNotification.isExisting()).toBe(true);
  });
});
