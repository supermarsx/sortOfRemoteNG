import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Updater', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Updater Tests');
  });

  it('should open updater panel', async () => {
    const updaterBtn = await $(S.updaterPanel);
    await updaterBtn.click();
    await browser.pause(500);

    const panel = await $('[data-testid="updater-panel-content"]');
    await panel.waitForDisplayed({ timeout: 5_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should trigger update check via Check for Updates button', async () => {
    const updaterBtn = await $(S.updaterPanel);
    await updaterBtn.click();
    await browser.pause(500);

    const checkBtn = await $('[data-testid="updater-check-btn"]');
    await checkBtn.waitForDisplayed({ timeout: 5_000 });
    await checkBtn.click();
    await browser.pause(3000);

    // Should show checking indicator or result
    const statusEl = await $('[data-testid="updater-status"]');
    await statusEl.waitForExist({ timeout: 10_000 });
    const statusText = await statusEl.getText();
    expect(statusText.length).toBeGreaterThan(0);
  });

  it('should display update channels', async () => {
    const updaterBtn = await $(S.updaterPanel);
    await updaterBtn.click();
    await browser.pause(500);

    const channelList = await $('[data-testid="updater-channel-list"]');
    await channelList.waitForDisplayed({ timeout: 5_000 });

    const channels = await $$('[data-testid="updater-channel-item"]');
    expect(channels.length).toBeGreaterThanOrEqual(1);

    // Verify known channel names exist
    const channelTexts: string[] = [];
    for (const ch of channels) {
      channelTexts.push(await ch.getText());
    }
    const combined = channelTexts.join(' ').toLowerCase();
    expect(combined).toContain('stable');
  });

  it('should show release notes', async () => {
    const updaterBtn = await $(S.updaterPanel);
    await updaterBtn.click();
    await browser.pause(500);

    const releaseNotesTab = await $('[data-testid="updater-release-notes-tab"]');
    if (await releaseNotesTab.isExisting()) {
      await releaseNotesTab.click();
      await browser.pause(1000);
    }

    const releaseNotes = await $('[data-testid="updater-release-notes"]');
    await releaseNotes.waitForDisplayed({ timeout: 5_000 });
    const notesText = await releaseNotes.getText();
    expect(notesText.length).toBeGreaterThan(0);
  });

  it('should display update history', async () => {
    const updaterBtn = await $(S.updaterPanel);
    await updaterBtn.click();
    await browser.pause(500);

    const historyTab = await $('[data-testid="updater-history-tab"]');
    if (await historyTab.isExisting()) {
      await historyTab.click();
      await browser.pause(1000);
    }

    const historyList = await $('[data-testid="updater-history-list"]');
    await historyList.waitForDisplayed({ timeout: 5_000 });
    expect(await historyList.isDisplayed()).toBe(true);
  });
});
