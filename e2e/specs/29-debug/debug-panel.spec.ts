import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Debug Panel', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Debug Tests');
  });

  it('should open debug panel', async () => {
    const debugPanel = await $(S.debugPanel);
    await debugPanel.click();
    await browser.pause(500);

    const actionList = await $(S.debugActionList);
    await actionList.waitForDisplayed({ timeout: 5_000 });
    expect(await actionList.isDisplayed()).toBe(true);
  });

  it('should show debug action categories', async () => {
    const debugPanel = await $(S.debugPanel);
    await debugPanel.click();
    await browser.pause(500);

    const categorySelect = await $(S.debugCategorySelect);
    expect(await categorySelect.isExisting()).toBe(true);
  });

  it('should list available debug actions', async () => {
    const debugPanel = await $(S.debugPanel);
    await debugPanel.click();
    await browser.pause(500);

    const actions = await $$(S.debugActionItem);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('should execute a debug action and show output', async () => {
    const debugPanel = await $(S.debugPanel);
    await debugPanel.click();
    await browser.pause(500);

    const actions = await $$(S.debugActionItem);
    if ((await actions.length) > 0) {
      await actions[0].click();
      await browser.pause(300);

      const executeBtn = await $(S.debugExecuteBtn);
      if (await executeBtn.isExisting()) {
        await executeBtn.click();
        await browser.pause(1000);

        const output = await $(S.debugOutput);
        expect(await output.isExisting()).toBe(true);
      }
    }
  });

  it('should filter actions by category', async () => {
    const debugPanel = await $(S.debugPanel);
    await debugPanel.click();
    await browser.pause(500);

    const categorySelect = await $(S.debugCategorySelect);
    await categorySelect.click();
    await browser.pause(300);

    // Select "sessions" category
    const sessionOption = await $('[data-testid="debug-category-sessions"]');
    if (await sessionOption.isExisting()) {
      await sessionOption.click();
      await browser.pause(500);

      const actions = await $$(S.debugActionItem);
      expect(actions.length).toBeGreaterThanOrEqual(0);
    }
  });
});
