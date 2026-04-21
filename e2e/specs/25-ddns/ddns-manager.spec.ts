import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('DDNS Manager — Profile Management', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('DDNS Tests');
  });

  it('should open DDNS manager panel', async () => {
    const ddnsBtn = await $(S.ddnsManager);
    await ddnsBtn.click();
    await browser.pause(500);

    const profilesTab = await $(S.ddnsTabProfiles);
    await profilesTab.waitForDisplayed({ timeout: 5_000 });
    expect(await profilesTab.isDisplayed()).toBe(true);
  });

  it('should show all 7 tabs', async () => {
    const ddnsBtn = await $(S.ddnsManager);
    await ddnsBtn.click();
    await browser.pause(500);

    const profilesTab = await $(S.ddnsTabProfiles);
    const healthTab = await $(S.ddnsTabHealth);
    const cloudflareTab = await $(S.ddnsTabCloudflare);
    const ipTab = await $(S.ddnsTabIp);
    const schedulerTab = await $(S.ddnsTabScheduler);
    const configTab = await $(S.ddnsTabConfig);
    const auditTab = await $(S.ddnsTabAudit);

    expect(await profilesTab.isExisting()).toBe(true);
    expect(await healthTab.isExisting()).toBe(true);
    expect(await cloudflareTab.isExisting()).toBe(true);
    expect(await ipTab.isExisting()).toBe(true);
    expect(await schedulerTab.isExisting()).toBe(true);
    expect(await configTab.isExisting()).toBe(true);
    expect(await auditTab.isExisting()).toBe(true);
  });

  it('should create a new DDNS profile', async () => {
    const ddnsBtn = await $(S.ddnsManager);
    await ddnsBtn.click();
    await browser.pause(500);

    const addBtn = await $(S.ddnsAddProfile);
    await addBtn.click();
    await browser.pause(300);

    const nameInput = await $(S.ddnsProfileName);
    await nameInput.setValue('Home Network');

    const providerSelect = await $(S.ddnsProvider);
    await providerSelect.selectByVisibleText('Cloudflare');

    const domainInput = await $(S.ddnsDomain);
    await domainInput.setValue('home.example.com');

    const apiKeyInput = await $(S.ddnsApiKey);
    await apiKeyInput.setValue('cf-api-key-placeholder');

    const saveBtn = await $(S.ddnsSaveProfile);
    await saveBtn.click();
    await browser.pause(500);

    const profiles = await $$(S.ddnsProfileItem);
    expect(profiles.length).toBeGreaterThanOrEqual(1);
  });

  it('should delete a DDNS profile', async () => {
    const ddnsBtn = await $(S.ddnsManager);
    await ddnsBtn.click();
    await browser.pause(500);

    // Create a profile first
    const addBtn = await $(S.ddnsAddProfile);
    await addBtn.click();
    await browser.pause(300);

    const nameInput = await $(S.ddnsProfileName);
    await nameInput.setValue('Delete Me');

    const providerSelect = await $(S.ddnsProvider);
    await providerSelect.selectByVisibleText('No-IP');

    const domainInput = await $(S.ddnsDomain);
    await domainInput.setValue('test.ddns.net');

    const saveBtn = await $(S.ddnsSaveProfile);
    await saveBtn.click();
    await browser.pause(500);

    const profilesBefore = await $$(S.ddnsProfileItem);
    const countBefore = await profilesBefore.length;

    // Delete the profile
    const deleteBtn = await profilesBefore[0].$(S.ddnsDeleteBtn);
    await deleteBtn.click();
    await browser.pause(300);

    const confirmBtn = await $(S.confirmYes);
    await confirmBtn.click();
    await browser.pause(500);

    const profilesAfter = await $$(S.ddnsProfileItem);
    expect(profilesAfter.length).toBe(countBefore - 1);
  });

  it('should trigger a manual IP update', async () => {
    const ddnsBtn = await $(S.ddnsManager);
    await ddnsBtn.click();
    await browser.pause(500);

    // Create a profile first
    const addBtn = await $(S.ddnsAddProfile);
    await addBtn.click();
    await browser.pause(300);

    const nameInput = await $(S.ddnsProfileName);
    await nameInput.setValue('Manual Update');

    const providerSelect = await $(S.ddnsProvider);
    await providerSelect.selectByVisibleText('Duck DNS');

    const domainInput = await $(S.ddnsDomain);
    await domainInput.setValue('myhost.duckdns.org');

    const saveBtn = await $(S.ddnsSaveProfile);
    await saveBtn.click();
    await browser.pause(500);

    // Trigger update
    const updateBtn = await $(S.ddnsUpdateBtn);
    await updateBtn.click();
    await browser.pause(3000);

    // Should show update result (success or failure)
    const profiles = await $$(S.ddnsProfileItem);
    const statusEl = await profiles[0].$('[data-testid="ddns-profile-status"]');
    expect(await statusEl.isExisting()).toBe(true);
  });
});

describe('DDNS Manager — IP Tracking', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('DDNS IP Tests');
  });

  it('should display current IP address', async () => {
    const ddnsBtn = await $(S.ddnsManager);
    await ddnsBtn.click();
    await browser.pause(500);

    const ipTab = await $(S.ddnsTabIp);
    await ipTab.click();
    await browser.pause(1000);

    const currentIp = await $(S.ddnsCurrentIp);
    await currentIp.waitForDisplayed({ timeout: 10_000 });
    const ipText = await currentIp.getText();
    // Should look like an IP address
    expect(ipText).toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[a-fA-F0-9:]+/);
  });

  it('should toggle IP version between IPv4 and IPv6', async () => {
    const ddnsBtn = await $(S.ddnsManager);
    await ddnsBtn.click();
    await browser.pause(500);

    const ipTab = await $(S.ddnsTabIp);
    await ipTab.click();
    await browser.pause(1000);

    const ipVersionToggle = await $(S.ddnsIpVersion);
    const initialText = await ipVersionToggle.getText();

    await ipVersionToggle.click();
    await browser.pause(1000);

    const newText = await ipVersionToggle.getText();
    expect(newText).not.toBe(initialText);
  });
});

describe('DDNS Manager — Audit Log', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('DDNS Audit Tests');
  });

  it('should show audit log tab', async () => {
    const ddnsBtn = await $(S.ddnsManager);
    await ddnsBtn.click();
    await browser.pause(500);

    const auditTab = await $(S.ddnsTabAudit);
    await auditTab.click();
    await browser.pause(500);

    const auditLog = await $(S.ddnsAuditLog);
    await auditLog.waitForDisplayed({ timeout: 5_000 });
    expect(await auditLog.isDisplayed()).toBe(true);
  });
});
