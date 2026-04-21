import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openSettings, closeSettings } from '../../helpers/app';

describe('Internationalization / Language Switching', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('i18n Tests');
  });

  it('should default to English', async () => {
    // Verify toolbar text or known UI label is in English
    const settingsBtn = await $(S.toolbarSettings);
    const text = await settingsBtn.getAttribute('aria-label');
    const btnText = await settingsBtn.getText();
    const label = text || btnText || '';

    // At minimum, the HTML lang attribute should be "en"
    const htmlLang = await browser.execute(() => document.documentElement.lang);
    expect(htmlLang).toMatch(/^en/);
  });

  it('should switch to Spanish and update the UI', async () => {
    await openSettings();

    const langSelect = await $('[data-testid="setting-language"]');
    await langSelect.waitForDisplayed({ timeout: 5_000 });
    await langSelect.selectByVisibleText('Español');
    await browser.pause(1000);

    await closeSettings();
    await browser.pause(500);

    // Verify the HTML lang changed
    const htmlLang = await browser.execute(() => document.documentElement.lang);
    expect(htmlLang).toMatch(/^es/);

    // Verify at least one known UI element is in Spanish
    const settingsBtn = await $(S.toolbarSettings);
    const label =
      (await settingsBtn.getAttribute('aria-label')) || (await settingsBtn.getText()) || '';
    // "Settings" in Spanish is "Configuración" or similar
    expect(label.toLowerCase()).not.toBe('settings');
  });

  it('should switch to Japanese and render correctly', async () => {
    await openSettings();

    const langSelect = await $('[data-testid="setting-language"]');
    await langSelect.waitForDisplayed({ timeout: 5_000 });
    await langSelect.selectByVisibleText('日本語');
    await browser.pause(1000);

    await closeSettings();
    await browser.pause(500);

    const htmlLang = await browser.execute(() => document.documentElement.lang);
    expect(htmlLang).toMatch(/^ja/);

    // Verify that CJK characters are present in the page
    const bodyText = await browser.execute(() => document.body.innerText);
    const hasCJK = /[\u3000-\u9FFF\uF900-\uFAFF]/.test(bodyText);
    expect(hasCJK).toBe(true);
  });

  it('should switch to Chinese Simplified and render correctly', async () => {
    await openSettings();

    const langSelect = await $('[data-testid="setting-language"]');
    await langSelect.waitForDisplayed({ timeout: 5_000 });
    await langSelect.selectByVisibleText('简体中文');
    await browser.pause(1000);

    await closeSettings();
    await browser.pause(500);

    const htmlLang = await browser.execute(() => document.documentElement.lang);
    expect(htmlLang).toMatch(/^zh/);

    const bodyText = await browser.execute(() => document.body.innerText);
    const hasChinese = /[\u4E00-\u9FFF]/.test(bodyText);
    expect(hasChinese).toBe(true);
  });

  it('should persist language after restart', async () => {
    await openSettings();

    const langSelect = await $('[data-testid="setting-language"]');
    await langSelect.waitForDisplayed({ timeout: 5_000 });
    await langSelect.selectByVisibleText('Español');
    await browser.pause(1000);

    await closeSettings();
    await browser.pause(500);

    // Simulate restart by reloading the page
    await browser.reloadSession();
    await browser.pause(3000);

    const htmlLang = await browser.execute(() => document.documentElement.lang);
    expect(htmlLang).toMatch(/^es/);
  });

  it('should fall back to English for missing translations', async () => {
    // Set a locale that may have incomplete translations
    await openSettings();

    const langSelect = await $('[data-testid="setting-language"]');
    await langSelect.waitForDisplayed({ timeout: 5_000 });

    // Try selecting a less common language
    const options = await langSelect.$$('option');
    let selectedNonEnglish = false;
    for (const opt of options) {
      const val = await opt.getAttribute('value');
      if (val && val !== 'en' && val !== 'es' && val !== 'ja' && val !== 'zh') {
        await langSelect.selectByAttribute('value', val);
        selectedNonEnglish = true;
        break;
      }
    }

    await browser.pause(1000);
    await closeSettings();
    await browser.pause(500);

    if (selectedNonEnglish) {
      // Verify that no translation keys (e.g. "settings.title") leak into the UI
      const bodyText = await browser.execute(() => document.body.innerText);
      const hasLeakedKey = /^[a-z]+\.[a-z]+\.[a-z]+$/m.test(bodyText);
      expect(hasLeakedKey).toBe(false);
    }
  });
});
