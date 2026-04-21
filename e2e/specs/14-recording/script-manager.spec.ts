import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';

describe('Script Manager', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Script Tests');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should create a script from the UI', async () => {
    const scriptBtn = await $('[data-testid="open-script-manager"]');
    await scriptBtn.click();
    await browser.pause(500);

    const panel = await $('[data-testid="script-manager-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });

    const createBtn = await $('[data-testid="script-create-btn"]');
    await createBtn.click();
    await browser.pause(300);

    const nameInput = await $('[data-testid="script-name-input"]');
    await nameInput.setValue('Health Check Script');

    const contentInput = await $('[data-testid="script-content-input"]');
    await contentInput.setValue('echo "Health OK"');

    const saveBtn = await $('[data-testid="script-save-btn"]');
    await saveBtn.click();
    await browser.pause(500);

    const scripts = await $$('[data-testid="script-item"]');
    expect(scripts.length).toBeGreaterThanOrEqual(1);
  });

  it('should execute a script in an active session', async () => {
    // Create a script
    const scriptBtn = await $('[data-testid="open-script-manager"]');
    await scriptBtn.click();
    await browser.pause(500);

    const createBtn = await $('[data-testid="script-create-btn"]');
    await createBtn.click();
    await browser.pause(300);

    const nameInput = await $('[data-testid="script-name-input"]');
    await nameInput.setValue('Run Script');

    const contentInput = await $('[data-testid="script-content-input"]');
    await contentInput.setValue('echo "script ran"');

    const saveBtn = await $('[data-testid="script-save-btn"]');
    await saveBtn.click();
    await browser.pause(500);

    // Execute
    const scripts = await $$('[data-testid="script-item"]');
    const execBtn = await scripts[0].$('[data-testid="script-execute-btn"]');
    await execBtn.click();
    await browser.pause(1_000);
  });

  it('should show script execution history', async () => {
    const scriptBtn = await $('[data-testid="open-script-manager"]');
    await scriptBtn.click();
    await browser.pause(500);

    const historyTab = await $('[data-testid="script-history-tab"]');
    await historyTab.click();
    await browser.pause(500);

    const historyList = await $('[data-testid="script-history-list"]');
    expect(await historyList.isDisplayed()).toBe(true);
  });
});
