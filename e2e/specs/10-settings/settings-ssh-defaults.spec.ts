import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Settings — SSH Defaults', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('SSH Defaults');
    await openSettings();
  });

  afterEach(async () => {
    await closeSettings();
  });

  it('should change default terminal font', async () => {
    const fontInput = await $('[data-testid="settings-ssh-font"]');
    await fontInput.clearValue();
    await fontInput.setValue('Fira Code');
    await browser.pause(300);

    expect(await fontInput.getValue()).toBe('Fira Code');
  });

  it('should change terminal colors', async () => {
    const colorPicker = await $('[data-testid="settings-ssh-bg-color"]');
    await colorPicker.click();
    await browser.pause(300);

    const colorInput = await $('[data-testid="color-picker-input"]');
    await colorInput.clearValue();
    await colorInput.setValue('#1a1a2e');
    await browser.pause(300);

    const confirmBtn = await $('[data-testid="color-picker-confirm"]');
    await confirmBtn.click();
    await browser.pause(300);
  });

  it('should change scrollback buffer size', async () => {
    const bufferInput = await $('[data-testid="settings-ssh-scrollback"]');
    await bufferInput.clearValue();
    await bufferInput.setValue('5000');
    await browser.pause(300);

    expect(await bufferInput.getValue()).toBe('5000');
  });

  it('should change SSH timeout defaults', async () => {
    const timeoutInput = await $('[data-testid="settings-ssh-timeout"]');
    await timeoutInput.clearValue();
    await timeoutInput.setValue('30');
    await browser.pause(300);

    expect(await timeoutInput.getValue()).toBe('30');
  });
});
