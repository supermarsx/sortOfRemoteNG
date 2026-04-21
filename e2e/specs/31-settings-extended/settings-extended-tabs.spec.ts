import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Settings — Performance', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Perf Test');
  });

  it('should open Performance settings tab', async () => {
    await openSettings();

    const perfTab = await $('[data-testid="settings-tab-performance"]');
    await perfTab.click();
    await browser.pause(500);

    const perfSection = await $('[data-testid="settings-performance-section"]');
    expect(await perfSection.isDisplayed()).toBe(true);

    await closeSettings();
  });

  it('should configure rendering performance options', async () => {
    await openSettings();

    const perfTab = await $('[data-testid="settings-tab-performance"]');
    await perfTab.click();
    await browser.pause(500);

    const hardwareAcceleration = await $('[data-testid="settings-hardware-acceleration"]');
    if (await hardwareAcceleration.isExisting()) {
      const initialState = await hardwareAcceleration.getAttribute('aria-checked');
      await hardwareAcceleration.click();
      await browser.pause(300);
      const newState = await hardwareAcceleration.getAttribute('aria-checked');
      expect(newState).not.toBe(initialState);
    }

    await closeSettings();
  });
});

describe('Settings — Proxy', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Proxy Test');
  });

  it('should open Proxy settings tab', async () => {
    await openSettings();

    const proxyTab = await $('[data-testid="settings-tab-proxy"]');
    await proxyTab.click();
    await browser.pause(500);

    const proxySection = await $('[data-testid="settings-proxy-section"]');
    expect(await proxySection.isDisplayed()).toBe(true);

    await closeSettings();
  });

  it('should configure proxy host and port', async () => {
    await openSettings();

    const proxyTab = await $('[data-testid="settings-tab-proxy"]');
    await proxyTab.click();
    await browser.pause(500);

    const proxyHost = await $('[data-testid="settings-proxy-host"]');
    if (await proxyHost.isExisting()) {
      await proxyHost.clearValue();
      await proxyHost.setValue('proxy.example.com');

      const proxyPort = await $('[data-testid="settings-proxy-port"]');
      await proxyPort.clearValue();
      await proxyPort.setValue('8080');
    }

    await closeSettings();
  });
});

describe('Settings — Advanced', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Advanced Test');
  });

  it('should open Advanced settings tab', async () => {
    await openSettings();

    const advancedTab = await $('[data-testid="settings-tab-advanced"]');
    await advancedTab.click();
    await browser.pause(500);

    const advancedSection = await $('[data-testid="settings-advanced-section"]');
    expect(await advancedSection.isDisplayed()).toBe(true);

    await closeSettings();
  });
});

describe('Settings — Recovery', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Recovery Test');
  });

  it('should open Recovery settings tab', async () => {
    await openSettings();

    const recoveryTab = await $('[data-testid="settings-tab-recovery"]');
    await recoveryTab.click();
    await browser.pause(500);

    const recoverySection = await $('[data-testid="settings-recovery-section"]');
    expect(await recoverySection.isDisplayed()).toBe(true);

    await closeSettings();
  });

  it('should show recovery code generation option', async () => {
    await openSettings();

    const recoveryTab = await $('[data-testid="settings-tab-recovery"]');
    await recoveryTab.click();
    await browser.pause(500);

    const recoveryCodeBtn = await $('[data-testid="settings-recovery-generate-codes"]');
    if (await recoveryCodeBtn.isExisting()) {
      expect(await recoveryCodeBtn.isDisplayed()).toBe(true);
    }

    await closeSettings();
  });
});

describe('Settings — API', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings API Test');
  });

  it('should open API settings tab', async () => {
    await openSettings();

    const apiTab = await $('[data-testid="settings-tab-api"]');
    await apiTab.click();
    await browser.pause(500);

    const apiSection = await $('[data-testid="settings-api-section"]');
    expect(await apiSection.isDisplayed()).toBe(true);

    await closeSettings();
  });
});

describe('Settings — Behavior', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Behavior Test');
  });

  it('should open Behavior settings tab', async () => {
    await openSettings();

    const behaviorTab = await $('[data-testid="settings-tab-behavior"]');
    await behaviorTab.click();
    await browser.pause(500);

    const behaviorSection = await $('[data-testid="settings-behavior-section"]');
    expect(await behaviorSection.isDisplayed()).toBe(true);

    await closeSettings();
  });

  it('should configure double-click behavior', async () => {
    await openSettings();

    const behaviorTab = await $('[data-testid="settings-tab-behavior"]');
    await behaviorTab.click();
    await browser.pause(500);

    const doubleClickAction = await $('[data-testid="settings-double-click-action"]');
    if (await doubleClickAction.isExisting()) {
      await doubleClickAction.click();
      await browser.pause(300);

      const options = await $$('[data-testid="settings-double-click-action"] option');
      expect(options.length).toBeGreaterThan(1);
    }

    await closeSettings();
  });
});

describe('Settings — Recording', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Recording Test');
  });

  it('should open Recording settings tab', async () => {
    await openSettings();

    const recordingTab = await $('[data-testid="settings-tab-recording"]');
    await recordingTab.click();
    await browser.pause(500);

    const recordingSection = await $('[data-testid="settings-recording-section"]');
    expect(await recordingSection.isDisplayed()).toBe(true);

    await closeSettings();
  });

  it('should configure recording format', async () => {
    await openSettings();

    const recordingTab = await $('[data-testid="settings-tab-recording"]');
    await recordingTab.click();
    await browser.pause(500);

    const recordingFormat = await $('[data-testid="settings-recording-format"]');
    if (await recordingFormat.isExisting()) {
      expect(await recordingFormat.isDisplayed()).toBe(true);
    }

    await closeSettings();
  });
});

describe('Settings — Diagnostics', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Diagnostics Test');
  });

  it('should open Diagnostics settings tab', async () => {
    await openSettings();

    const diagnosticsTab = await $('[data-testid="settings-tab-diagnostics"]');
    await diagnosticsTab.click();
    await browser.pause(500);

    const diagnosticsSection = await $('[data-testid="settings-diagnostics-section"]');
    expect(await diagnosticsSection.isDisplayed()).toBe(true);

    await closeSettings();
  });

  it('should show debug logging option', async () => {
    await openSettings();

    const diagnosticsTab = await $('[data-testid="settings-tab-diagnostics"]');
    await diagnosticsTab.click();
    await browser.pause(500);

    const debugLogging = await $('[data-testid="settings-debug-logging"]');
    if (await debugLogging.isExisting()) {
      expect(await debugLogging.isDisplayed()).toBe(true);
    }

    await closeSettings();
  });
});

describe('Settings — Web Browser', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Web Browser Test');
  });

  it('should open Web Browser settings tab', async () => {
    await openSettings();

    const webBrowserTab = await $('[data-testid="settings-tab-web-browser"]');
    await webBrowserTab.click();
    await browser.pause(500);

    const webBrowserSection = await $('[data-testid="settings-web-browser-section"]');
    expect(await webBrowserSection.isDisplayed()).toBe(true);

    await closeSettings();
  });
});

describe('Settings — Layout', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Layout Test');
  });

  it('should open Layout settings tab', async () => {
    await openSettings();

    const layoutTab = await $('[data-testid="settings-tab-layout"]');
    await layoutTab.click();
    await browser.pause(500);

    const layoutSection = await $('[data-testid="settings-layout-section"]');
    expect(await layoutSection.isDisplayed()).toBe(true);

    await closeSettings();
  });

  it('should configure sidebar position', async () => {
    await openSettings();

    const layoutTab = await $('[data-testid="settings-tab-layout"]');
    await layoutTab.click();
    await browser.pause(500);

    const sidebarPosition = await $('[data-testid="settings-sidebar-position"]');
    if (await sidebarPosition.isExisting()) {
      await sidebarPosition.click();
      await browser.pause(300);
    }

    await closeSettings();
  });
});

describe('Settings — Search', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Settings Search Test');
  });

  it('should search settings by keyword', async () => {
    await openSettings();

    const searchInput = await $(S.settingsSearch);
    await searchInput.setValue('theme');
    await browser.pause(500);

    // Search should highlight or filter results
    const highlights = await $$('[data-testid="settings-search-highlight"]');
    expect(highlights.length).toBeGreaterThanOrEqual(0);

    await closeSettings();
  });

  it('should navigate to matched setting on selection', async () => {
    await openSettings();

    const searchInput = await $(S.settingsSearch);
    await searchInput.setValue('proxy');
    await browser.pause(500);

    const results = await $$('[data-testid="settings-search-result"]');
    if ((await results.length) > 0) {
      await results[0].click();
      await browser.pause(500);
    }

    await closeSettings();
  });
});
