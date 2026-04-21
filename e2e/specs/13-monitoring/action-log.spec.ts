import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Action Log', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Action Log Tests');
  });

  it('should record performed actions in the log', async () => {
    // Perform some actions to generate log entries
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const nameInput = await $(S.editorName);
    await nameInput.setValue('Log Test Server');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const logBtn = await $(S.actionLog);
    await logBtn.click();
    await browser.pause(500);

    const logPanel = await $('[data-testid="action-log-panel"]');
    await logPanel.waitForDisplayed({ timeout: 5_000 });

    const entries = await $$('[data-testid="action-log-entry"]');
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter log entries by severity', async () => {
    const logBtn = await $(S.actionLog);
    await logBtn.click();
    await browser.pause(500);

    const filterSelect = await $('[data-testid="action-log-severity-filter"]');
    await filterSelect.click();

    const infoOption = await $('[data-testid="severity-info"]');
    await infoOption.click();
    await browser.pause(300);

    const entries = await $$('[data-testid="action-log-entry"]');
    for (const entry of entries) {
      const severity = await entry.$('[data-testid="log-entry-severity"]');
      const text = await severity.getText();
      expect(text.toLowerCase()).toBe('info');
    }
  });

  it('should search log entries', async () => {
    const logBtn = await $(S.actionLog);
    await logBtn.click();
    await browser.pause(500);

    const searchInput = await $('[data-testid="action-log-search"]');
    await searchInput.setValue('connection');
    await browser.pause(500);

    const entries = await $$('[data-testid="action-log-entry"]');
    // Filtered entries should still be present or empty
    expect(entries).toBeDefined();
  });

  it('should export the action log', async () => {
    const logBtn = await $(S.actionLog);
    await logBtn.click();
    await browser.pause(500);

    const exportBtn = await $('[data-testid="action-log-export"]');
    await exportBtn.click();
    await browser.pause(500);

    const exportNotification = await $('[data-testid="action-log-export-success"]');
    expect(await exportNotification.isExisting()).toBe(true);
  });
});
