import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  openSettings,
  closeSettings,
  waitForAppReady,
} from "../../helpers/app";

const LANGUAGE_TAB = '[data-testid="settings-tab-language"]';
const AUTO_DETECT_TOGGLE =
  '[data-setting-key="autoDetectOsLanguage"] input[type="checkbox"]';
const LANGUAGE_SELECT = '[data-setting-key="language"] [role="combobox"]';

async function documentLanguage(): Promise<string> {
  return browser.execute(() => document.documentElement.lang);
}

async function waitForDocumentLanguage(language: string): Promise<void> {
  await browser.waitUntil(async () => (await documentLanguage()) === language, {
    timeout: 10_000,
    interval: 100,
    timeoutMsg: `Expected document language to become ${language}`,
  });
}

async function waitForSettingsTitle(title: string): Promise<void> {
  const settingsButton = await $(S.toolbarSettings);
  await browser.waitUntil(
    async () => (await settingsButton.getAttribute("title")) === title,
    {
      timeout: 10_000,
      interval: 100,
      timeoutMsg: `Expected settings title to become ${title}`,
    },
  );
}

async function openLanguageSettings(): Promise<void> {
  await openSettings();
  const languageTab = await $(LANGUAGE_TAB);
  await languageTab.waitForClickable({ timeout: 5_000 });
  await languageTab.click();
  await $(LANGUAGE_SELECT).waitForExist({ timeout: 5_000 });
}

async function disableAutomaticLanguageDetection(): Promise<void> {
  const toggle = await $(AUTO_DETECT_TOGGLE);
  await toggle.waitForExist({ timeout: 5_000 });
  if (await toggle.isSelected()) {
    await toggle.click();
    await browser.waitUntil(async () => !(await toggle.isSelected()), {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: "Expected automatic language detection to be disabled",
    });
  }
  await $(LANGUAGE_SELECT).waitForClickable({ timeout: 5_000 });
}

async function chooseLanguage(label: string, language: string): Promise<void> {
  await disableAutomaticLanguageDetection();
  const select = await $(LANGUAGE_SELECT);
  if ((await select.getText()).trim() !== label) {
    await select.click();
    const option = await $(
      `//*[@role="option" and normalize-space(.)="${label}"]`,
    );
    await option.waitForDisplayed({ timeout: 5_000 });
    await option.click();
  }
  await waitForDocumentLanguage(language);
}

describe("Internationalization / Language Switching", () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection("i18n Tests");

    // Native settings persist across WebDriver sessions. Establish an explicit
    // baseline so every test is independent of the locale selected previously.
    await openLanguageSettings();
    await chooseLanguage("English (US)", "en-US");
    await browser.pause(1_700);
    await closeSettings();
  });

  it("defaults to explicit English", async () => {
    expect(await documentLanguage()).toBe("en-US");
    await waitForSettingsTitle("Settings");
  });

  it("switches to Spanish and updates the UI immediately", async () => {
    await openLanguageSettings();
    await chooseLanguage("Español (España)", "es-ES");
    await closeSettings();

    await waitForSettingsTitle("Configuración");
  });

  it("switches to Japanese and renders its translated title", async () => {
    await openLanguageSettings();
    await chooseLanguage("日本語 (日本)", "ja-JP");
    await closeSettings();

    await waitForSettingsTitle("設定");
  });

  it("switches to Simplified Chinese and renders its translated title", async () => {
    await openLanguageSettings();
    await chooseLanguage("中文 (简体, 中国)", "zh-CN");
    await closeSettings();

    await waitForSettingsTitle("设置");
  });

  it("loads both styled-English locales without leaking translation keys", async () => {
    await openLanguageSettings();
    await chooseLanguage("English (Leetspeak)", "en-x-leet");
    await closeSettings();
    await waitForSettingsTitle("53771n65");

    await openLanguageSettings();
    await chooseLanguage("English (Pirate)", "en-x-pirate");
    const dialogText = await $(S.settingsDialog).getText();
    expect(dialogText).not.toContain("settings.title");
    expect(dialogText).not.toContain("toolbar.settings");
    await closeSettings();
    await waitForSettingsTitle("Ship's settings");
  });

  it("persists a styled-English locale after a WebDriver restart", async () => {
    await openLanguageSettings();
    await chooseLanguage("English (Pirate)", "en-x-pirate");

    // Settings auto-save is debounced by 1.5 seconds; wait for the disk write
    // before restarting the native WebDriver session.
    await browser.pause(1_700);
    await closeSettings();
    await browser.reloadSession();
    await waitForAppReady();

    await waitForDocumentLanguage("en-x-pirate");
    await waitForSettingsTitle("Ship's settings");
  });
});
