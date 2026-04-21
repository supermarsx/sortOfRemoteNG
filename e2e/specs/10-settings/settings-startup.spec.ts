import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Settings — Startup', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Startup Settings');
    await openSettings();
  });

  afterEach(async () => {
    await closeSettings();
  });

  it('should toggle start maximized setting', async () => {
    const toggle = await $('[data-testid="settings-start-maximized"]');
    const initial = await toggle.getAttribute('aria-checked');

    await toggle.click();
    await browser.pause(300);

    const updated = await toggle.getAttribute('aria-checked');
    expect(updated).not.toBe(initial);
  });

  it('should toggle auto-open last collection setting', async () => {
    const toggle = await $('[data-testid="settings-auto-open-collection"]');
    const initial = await toggle.getAttribute('aria-checked');

    await toggle.click();
    await browser.pause(300);

    const updated = await toggle.getAttribute('aria-checked');
    expect(updated).not.toBe(initial);
  });

  it('should toggle reconnect previous sessions setting', async () => {
    const toggle = await $('[data-testid="settings-reconnect-sessions"]');
    const initial = await toggle.getAttribute('aria-checked');

    await toggle.click();
    await browser.pause(300);

    const updated = await toggle.getAttribute('aria-checked');
    expect(updated).not.toBe(initial);
  });

  it('should change default behavior settings', async () => {
    const defaultBehavior = await $('[data-testid="settings-default-behavior"]');
    await defaultBehavior.click();

    const options = await $$('[data-testid="default-behavior-option"]');
    expect(options.length).toBeGreaterThan(0);

    await options[0].click();
    await browser.pause(300);

    const selected = await defaultBehavior.getText();
    expect(selected.length).toBeGreaterThan(0);
  });
});
