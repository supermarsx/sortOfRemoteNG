import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Health Dashboard', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Monitoring Tests');
  });

  it('should open health dashboard', async () => {
    const dashBtn = await $(S.healthDashboard);
    await dashBtn.click();
    await browser.pause(500);

    const panel = await $('[data-testid="health-dashboard-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should display status indicators for connections', async () => {
    // Create a connection first
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const nameInput = await $(S.editorName);
    await nameInput.setValue('Monitored Server');
    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('10.0.0.1');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const dashBtn = await $(S.healthDashboard);
    await dashBtn.click();
    await browser.pause(500);

    const indicators = await $$('[data-testid="monitoring-status-indicator"]');
    expect(indicators.length).toBeGreaterThanOrEqual(1);
  });

  it('should render heatmap visualization', async () => {
    const dashBtn = await $(S.healthDashboard);
    await dashBtn.click();
    await browser.pause(500);

    const heatmap = await $('[data-testid="health-heatmap"]');
    expect(await heatmap.isExisting()).toBe(true);
  });

  it('should show quick stats with connected and total counts', async () => {
    const dashBtn = await $(S.healthDashboard);
    await dashBtn.click();
    await browser.pause(500);

    const connectedCount = await $('[data-testid="health-connected-count"]');
    expect(await connectedCount.isExisting()).toBe(true);

    const totalCount = await $('[data-testid="health-total-count"]');
    expect(await totalCount.isExisting()).toBe(true);
  });
});
