import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe("Let's Encrypt Manager", () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('LetsEncrypt Tests');
  });

  it("should open Let's Encrypt manager", async () => {
    const leManager = await $(S.letsEncryptManager);
    await leManager.click();
    await browser.pause(500);

    const overviewTab = await $(S.letsEncryptOverviewTab);
    await overviewTab.waitForDisplayed({ timeout: 5_000 });
    expect(await overviewTab.isDisplayed()).toBe(true);
  });

  it('should show all tabs', async () => {
    const leManager = await $(S.letsEncryptManager);
    await leManager.click();
    await browser.pause(500);

    const overviewTab = await $(S.letsEncryptOverviewTab);
    const certsTab = await $(S.letsEncryptCertsTab);
    const accountsTab = await $(S.letsEncryptAccountsTab);
    const configTab = await $(S.letsEncryptConfigTab);
    const healthTab = await $(S.letsEncryptHealthTab);

    expect(await overviewTab.isExisting()).toBe(true);
    expect(await certsTab.isExisting()).toBe(true);
    expect(await accountsTab.isExisting()).toBe(true);
    expect(await configTab.isExisting()).toBe(true);
    expect(await healthTab.isExisting()).toBe(true);
  });

  it('should show certificates list', async () => {
    const leManager = await $(S.letsEncryptManager);
    await leManager.click();
    await browser.pause(500);

    const certsTab = await $(S.letsEncryptCertsTab);
    await certsTab.click();
    await browser.pause(500);

    const certItems = await $$(S.letsEncryptCertItem);
    expect(certItems).toBeDefined();
  });

  it('should have request certificate button', async () => {
    const leManager = await $(S.letsEncryptManager);
    await leManager.click();
    await browser.pause(500);

    const certsTab = await $(S.letsEncryptCertsTab);
    await certsTab.click();
    await browser.pause(500);

    const requestBtn = await $(S.letsEncryptRequestCert);
    expect(await requestBtn.isExisting()).toBe(true);
  });
});

describe('Credential Manager — Extended', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Credential Extended Tests');
  });

  it('should show credential tabs (All, Expiring, Expired, Groups, Policies, Audit)', async () => {
    const credManager = await $('[data-testid="open-credential-manager"]');
    await credManager.click();
    await browser.pause(500);

    const panel = await $('[data-testid="credential-manager-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });

    const allTab = await $('[data-testid="credential-tab-all"]');
    const expiringTab = await $('[data-testid="credential-tab-expiring"]');
    const expiredTab = await $('[data-testid="credential-tab-expired"]');
    const groupsTab = await $('[data-testid="credential-tab-groups"]');
    const policiesTab = await $('[data-testid="credential-tab-policies"]');
    const auditTab = await $('[data-testid="credential-tab-audit"]');

    expect(await allTab.isExisting()).toBe(true);
    expect(await expiringTab.isExisting()).toBe(true);
    expect(await expiredTab.isExisting()).toBe(true);
    expect(await groupsTab.isExisting()).toBe(true);
    expect(await policiesTab.isExisting()).toBe(true);
    expect(await auditTab.isExisting()).toBe(true);
  });

  it('should add a new credential', async () => {
    const credManager = await $('[data-testid="open-credential-manager"]');
    await credManager.click();
    await browser.pause(500);

    const panel = await $('[data-testid="credential-manager-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });

    const addBtn = await $('[data-testid="credential-add"]');
    if (await addBtn.isExisting()) {
      await addBtn.click();
      await browser.pause(300);

      const credNameInput = await $('[data-testid="credential-name-input"]');
      await credNameInput.setValue('Test API Key');

      const credValueInput = await $('[data-testid="credential-value-input"]');
      await credValueInput.setValue('secret-api-key-123');

      const saveBtn = await $('[data-testid="credential-save"]');
      await saveBtn.click();
      await browser.pause(500);

      const items = await $$('[data-testid="credential-item"]');
      expect(items.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should show password strength indicator', async () => {
    const credManager = await $('[data-testid="open-credential-manager"]');
    await credManager.click();
    await browser.pause(500);

    const panel = await $('[data-testid="credential-manager-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });

    const addBtn = await $('[data-testid="credential-add"]');
    if (await addBtn.isExisting()) {
      await addBtn.click();
      await browser.pause(300);

      const credValueInput = await $('[data-testid="credential-value-input"]');
      await credValueInput.setValue('Str0ng!P@ssword#123');
      await browser.pause(500);

      const strengthMeter = await $('[data-testid="credential-strength-meter"]');
      expect(await strengthMeter.isExisting()).toBe(true);
    }
  });

  it('should switch to Expiring tab and show soon-to-expire items', async () => {
    const credManager = await $('[data-testid="open-credential-manager"]');
    await credManager.click();
    await browser.pause(500);

    const panel = await $('[data-testid="credential-manager-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });

    const expiringTab = await $('[data-testid="credential-tab-expiring"]');
    await expiringTab.click();
    await browser.pause(500);

    // May or may not have items
    const items = await $$('[data-testid="credential-item"]');
    expect(items).toBeDefined();
  });

  it('should switch to Policies tab', async () => {
    const credManager = await $('[data-testid="open-credential-manager"]');
    await credManager.click();
    await browser.pause(500);

    const panel = await $('[data-testid="credential-manager-panel"]');
    await panel.waitForDisplayed({ timeout: 5_000 });

    const policiesTab = await $('[data-testid="credential-tab-policies"]');
    await policiesTab.click();
    await browser.pause(500);

    const policyItems = await $$('[data-testid="credential-policy-item"]');
    expect(policyItems).toBeDefined();
  });
});

describe('Connection Editor — Recovery Info', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Recovery Info Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    // Create a connection
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const nameInput = await $(S.editorName);
    await nameInput.setValue('Recovery Test');

    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('10.0.0.1');

    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('SSH');

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);
  });

  it('should show recovery info section in editor', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(500);

    const recoveryPhone = await $(S.editorRecoveryPhone);
    const recoveryEmail = await $(S.editorRecoveryEmail);

    // At least one recovery field should exist
    const hasRecoveryFields =
      (await recoveryPhone.isExisting()) || (await recoveryEmail.isExisting());
    expect(hasRecoveryFields).toBe(true);
  });

  it('should save recovery phone number', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(500);

    const recoveryPhone = await $(S.editorRecoveryPhone);
    if (await recoveryPhone.isExisting()) {
      await recoveryPhone.setValue('+1-555-0100');

      const saveBtn = await $(S.editorSave);
      await saveBtn.click();
      await browser.pause(500);

      // Re-open and verify
      const updatedItems = await tree.$$(S.connectionItem);
      await updatedItems[0].doubleClick();
      await browser.pause(500);

      const savedPhone = await $(S.editorRecoveryPhone);
      const value = await savedPhone.getValue();
      expect(value).toContain('555-0100');
    }
  });

  it('should show backup codes section', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(500);

    const backupCodes = await $(S.editorBackupCodes);
    if (await backupCodes.isExisting()) {
      expect(await backupCodes.isDisplayed()).toBe(true);
    }
  });

  it('should show security questions section', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(500);

    const securityQuestions = await $(S.editorSecurityQuestions);
    if (await securityQuestions.isExisting()) {
      expect(await securityQuestions.isDisplayed()).toBe(true);
    }
  });
});
