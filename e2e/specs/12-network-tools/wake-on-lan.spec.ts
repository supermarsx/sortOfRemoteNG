import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Wake-on-LAN', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('WOL Tests');
  });

  it('should send a WOL packet', async () => {
    // Create a connection with MAC address
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const nameInput = await $(S.editorName);
    await nameInput.setValue('WOL Server');
    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('10.0.0.50');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    // Right-click for context menu
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    for (const item of items) {
      const text = await item.getText();
      if (text.includes('WOL Server')) {
        await item.click({ button: 'right' });
        break;
      }
    }

    const wolOption = await $('[data-testid="context-wake-on-lan"]');
    await wolOption.click();
    await browser.pause(1_000);

    const notification = await $('[data-testid="wol-sent-notification"]');
    expect(await notification.isExisting()).toBe(true);
  });

  it('should create a WOL schedule', async () => {
    const wolScheduleBtn = await $('[data-testid="open-wol-scheduler"]');
    await wolScheduleBtn.click();
    await browser.pause(500);

    const createBtn = await $('[data-testid="wol-schedule-create"]');
    await createBtn.click();

    const targetInput = await $('[data-testid="wol-schedule-target"]');
    await targetInput.setValue('AA:BB:CC:DD:EE:FF');

    const timeInput = await $('[data-testid="wol-schedule-time"]');
    await timeInput.setValue('08:00');

    const saveBtn = await $('[data-testid="wol-schedule-save"]');
    await saveBtn.click();
    await browser.pause(500);

    const schedules = await $$('[data-testid="wol-schedule-item"]');
    expect(schedules.length).toBeGreaterThanOrEqual(1);
  });
});
