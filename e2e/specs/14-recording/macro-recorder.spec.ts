import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';

describe('Macro Recorder', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Macro Tests');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should open macro recorder panel', async () => {
    const macroBtn = await $('[data-testid="open-macro-recorder"]');
    await macroBtn.click();
    await browser.pause(500);

    const panel = await $('[data-testid="macro-recorder-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should record keystrokes as a macro', async () => {
    const macroBtn = await $('[data-testid="open-macro-recorder"]');
    await macroBtn.click();
    await browser.pause(500);

    const recordBtn = await $('[data-testid="macro-record-btn"]');
    await recordBtn.click();
    await browser.pause(300);

    // Type some keystrokes
    for (const ch of 'uptime') {
      await browser.keys(ch);
    }
    await browser.keys('Enter');
    await browser.pause(500);

    const stopBtn = await $('[data-testid="macro-stop-btn"]');
    await stopBtn.click();
    await browser.pause(500);

    const nameInput = await $('[data-testid="macro-name-input"]');
    await nameInput.setValue('Check Uptime');

    const saveBtn = await $('[data-testid="macro-save-btn"]');
    await saveBtn.click();
    await browser.pause(500);

    const macros = await $$('[data-testid="macro-item"]');
    expect(macros.length).toBeGreaterThanOrEqual(1);
  });

  it('should replay a saved macro', async () => {
    // Record a macro first
    const macroBtn = await $('[data-testid="open-macro-recorder"]');
    await macroBtn.click();
    await browser.pause(500);

    const recordBtn = await $('[data-testid="macro-record-btn"]');
    await recordBtn.click();
    await browser.pause(300);

    for (const ch of 'date') {
      await browser.keys(ch);
    }
    await browser.keys('Enter');
    await browser.pause(500);

    const stopBtn = await $('[data-testid="macro-stop-btn"]');
    await stopBtn.click();
    await browser.pause(500);

    const nameInput = await $('[data-testid="macro-name-input"]');
    await nameInput.setValue('Check Date');

    const saveBtn = await $('[data-testid="macro-save-btn"]');
    await saveBtn.click();
    await browser.pause(500);

    // Replay
    const macros = await $$('[data-testid="macro-item"]');
    const replayBtn = await macros[0].$('[data-testid="macro-replay-btn"]');
    await replayBtn.click();
    await browser.pause(1_000);
  });
});
