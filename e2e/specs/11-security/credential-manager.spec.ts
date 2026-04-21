import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Credential Manager', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Credential Tests');
  });

  it('should open credential manager', async () => {
    const credManagerBtn = await $('[data-testid="open-credential-manager"]');
    await credManagerBtn.click();
    await browser.pause(500);

    const panel = await $('[data-testid="credential-manager-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should display credentials across connections', async () => {
    // Create connections with credentials first
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const nameInput = await $(S.editorName);
    await nameInput.setValue('Cred Server');
    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('10.0.0.1');
    const usernameInput = await $(S.editorUsername);
    await usernameInput.setValue('admin');
    const passwordInput = await $(S.editorPassword);
    await passwordInput.setValue('secret123');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const credManagerBtn = await $('[data-testid="open-credential-manager"]');
    await credManagerBtn.click();
    await browser.pause(500);

    const credItems = await $$('[data-testid="credential-item"]');
    expect(credItems.length).toBeGreaterThanOrEqual(1);
  });

  it('should show credential strength meter', async () => {
    const credManagerBtn = await $('[data-testid="open-credential-manager"]');
    await credManagerBtn.click();
    await browser.pause(500);

    const strengthMeter = await $('[data-testid="credential-strength-meter"]');
    expect(await strengthMeter.isExisting()).toBe(true);
  });

  it('should show expiring credentials tab', async () => {
    const credManagerBtn = await $('[data-testid="open-credential-manager"]');
    await credManagerBtn.click();
    await browser.pause(500);

    const expiringTab = await $('[data-testid="credential-expiring-tab"]');
    await expiringTab.click();
    await browser.pause(300);

    const panel = await $('[data-testid="credential-expiring-list"]');
    expect(await panel.isDisplayed()).toBe(true);
  });
});
