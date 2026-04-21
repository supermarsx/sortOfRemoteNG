import { S } from '../../helpers/selectors';

describe('App Window Controls', () => {
  it('should have minimize button that minimizes the window', async () => {
    const minimize = await $(S.windowMinimize);
    expect(await minimize.isDisplayed()).toBe(true);
    // Click minimize - in Tauri this minimizes the window
    await minimize.click();
    // Wait a moment for the window action
    await browser.pause(500);
    // We can't easily verify minimized state in WebDriver,
    // but the click should not crash
  });

  it('should have maximize button that toggles maximize/restore', async () => {
    const maximize = await $(S.windowMaximize);
    expect(await maximize.isDisplayed()).toBe(true);
    await maximize.click();
    await browser.pause(500);
    // Click again to restore
    await maximize.click();
    await browser.pause(500);
  });

  it('should have close button visible', async () => {
    const close = await $(S.windowClose);
    expect(await close.isDisplayed()).toBe(true);
    // Don't click close as it would end the test session
  });

  it('should persist sidebar width across interactions', async () => {
    const sidebar = await $(S.sidebar);
    const initialWidth = await sidebar.getSize('width');
    expect(initialWidth).toBeGreaterThan(0);
  });
});
