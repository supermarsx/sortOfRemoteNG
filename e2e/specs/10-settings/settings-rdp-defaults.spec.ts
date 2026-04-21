import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Settings — RDP Defaults', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('RDP Defaults');
    await openSettings();
  });

  afterEach(async () => {
    await closeSettings();
  });

  it('should change default resolution', async () => {
    const resolutionSelect = await $('[data-testid="settings-rdp-resolution"]');
    await resolutionSelect.click();

    const option = await $('[data-testid="rdp-resolution-1920x1080"]');
    await option.click();
    await browser.pause(300);

    const selected = await resolutionSelect.getText();
    expect(selected).toContain('1920');
  });

  it('should change default color depth', async () => {
    const colorDepthSelect = await $('[data-testid="settings-rdp-color-depth"]');
    await colorDepthSelect.click();

    const option = await $('[data-testid="rdp-color-depth-32"]');
    await option.click();
    await browser.pause(300);

    const selected = await colorDepthSelect.getText();
    expect(selected).toContain('32');
  });

  it('should configure device redirection defaults', async () => {
    const clipboardToggle = await $('[data-testid="settings-rdp-clipboard"]');
    const initial = await clipboardToggle.getAttribute('aria-checked');

    await clipboardToggle.click();
    await browser.pause(300);

    const updated = await clipboardToggle.getAttribute('aria-checked');
    expect(updated).not.toBe(initial);
  });
});
