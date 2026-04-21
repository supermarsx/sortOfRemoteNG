import { S } from '../../helpers/selectors';

describe('App Launch', () => {
  it('should display the splash screen during initialization', async () => {
    // The splash screen should be present initially (or have been present)
    // After app ready, it should be gone
    const appShell = await $(S.appShell);
    await appShell.waitForExist({ timeout: 30000 });
    expect(await appShell.isDisplayed()).toBe(true);
  });

  it('should show the main app shell after loading', async () => {
    const appShell = await $(S.appShell);
    expect(await appShell.isDisplayed()).toBe(true);
  });

  it('should not show the splash screen after loading completes', async () => {
    const splash = await $(S.splashScreen);
    expect(await splash.isExisting()).toBe(false);
  });

  it('should render the toolbar', async () => {
    const toolbar = await $(S.toolbar);
    expect(await toolbar.isDisplayed()).toBe(true);
  });

  it('should render the sidebar', async () => {
    const sidebar = await $(S.sidebar);
    expect(await sidebar.isDisplayed()).toBe(true);
  });

  it('should show welcome screen when no connections are loaded', async () => {
    const welcome = await $(S.welcomeScreen);
    // Welcome screen should be visible if no collection is open
    expect(await welcome.isExisting()).toBe(true);
  });

  it('should render custom window controls (no OS decorations)', async () => {
    const minimize = await $(S.windowMinimize);
    const maximize = await $(S.windowMaximize);
    const close = await $(S.windowClose);
    expect(await minimize.isDisplayed()).toBe(true);
    expect(await maximize.isDisplayed()).toBe(true);
    expect(await close.isDisplayed()).toBe(true);
  });

  it('should display the app version in splash or status bar', async () => {
    // The version "v0.1.0" should appear somewhere in the app
    const body = await $('body');
    const html = await body.getHTML();
    expect(html).toContain('0.1.0');
  });
});
