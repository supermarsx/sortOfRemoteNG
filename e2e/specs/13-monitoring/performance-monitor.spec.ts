import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Performance Monitor', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Performance Tests');
  });

  it('should open performance monitor', async () => {
    const perfBtn = await $(S.performanceMonitor);
    await perfBtn.click();
    await browser.pause(500);

    const panel = await $('[data-testid="performance-monitor-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should display real-time metrics', async () => {
    const perfBtn = await $(S.performanceMonitor);
    await perfBtn.click();
    await browser.pause(1_000);

    const realtimeChart = await $('[data-testid="performance-realtime-chart"]');
    expect(await realtimeChart.isExisting()).toBe(true);

    const cpuMetric = await $('[data-testid="metric-cpu"]');
    expect(await cpuMetric.isExisting()).toBe(true);

    const memMetric = await $('[data-testid="metric-memory"]');
    expect(await memMetric.isExisting()).toBe(true);
  });

  it('should show historical metrics table', async () => {
    const perfBtn = await $(S.performanceMonitor);
    await perfBtn.click();
    await browser.pause(500);

    const historyTab = await $('[data-testid="performance-history-tab"]');
    await historyTab.click();
    await browser.pause(500);

    const table = await $('[data-testid="performance-history-table"]');
    await table.waitForDisplayed({ timeout: 5_000 });
    expect(await table.isDisplayed()).toBe(true);
  });
});
