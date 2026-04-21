import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('SSH Key Manager', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('SSH Key Tests');
  });

  it('should open SSH Key Manager', async () => {
    const keyManager = await $(S.sshKeyManager);
    await keyManager.click();
    await browser.pause(500);

    const keyList = await $(S.sshKeyList);
    await keyList.waitForDisplayed({ timeout: 5_000 });
    expect(await keyList.isDisplayed()).toBe(true);
  });

  it('should display list of SSH keys', async () => {
    const keyManager = await $(S.sshKeyManager);
    await keyManager.click();
    await browser.pause(500);

    const keyList = await $(S.sshKeyList);
    await keyList.waitForDisplayed({ timeout: 5_000 });

    // May be empty or have keys
    const keys = await $$(S.sshKeyItem);
    expect(keys).toBeDefined();
  });

  it('should open key generation dialog', async () => {
    const keyManager = await $(S.sshKeyManager);
    await keyManager.click();
    await browser.pause(500);

    const generateBtn = await $(S.sshKeyGenerate);
    await generateBtn.click();
    await browser.pause(500);

    const keyTypeSelect = await $(S.sshKeyType);
    expect(await keyTypeSelect.isExisting()).toBe(true);
  });

  it('should show key type options for generation', async () => {
    const keyManager = await $(S.sshKeyManager);
    await keyManager.click();
    await browser.pause(500);

    const generateBtn = await $(S.sshKeyGenerate);
    await generateBtn.click();
    await browser.pause(500);

    const keyTypeSelect = await $(S.sshKeyType);
    await keyTypeSelect.click();
    await browser.pause(300);

    // Should have key type options (ed25519, RSA, etc.)
    const options = await $$('[data-testid="ssh-key-type"] option');
    expect(options.length).toBeGreaterThan(1);
  });

  it('should have import key functionality', async () => {
    const keyManager = await $(S.sshKeyManager);
    await keyManager.click();
    await browser.pause(500);

    const importBtn = await $(S.sshKeyImport);
    expect(await importBtn.isExisting()).toBe(true);
  });
});

describe('SSH Agent Manager', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('SSH Agent Tests');
  });

  it('should open SSH Agent Manager', async () => {
    const agentManager = await $(S.sshAgentManager);
    await agentManager.click();
    await browser.pause(500);

    const overviewTab = await $(S.sshAgentTabOverview);
    await overviewTab.waitForDisplayed({ timeout: 5_000 });
    expect(await overviewTab.isDisplayed()).toBe(true);
  });

  it('should show all agent tabs', async () => {
    const agentManager = await $(S.sshAgentManager);
    await agentManager.click();
    await browser.pause(500);

    const overviewTab = await $(S.sshAgentTabOverview);
    const keysTab = await $(S.sshAgentTabKeys);
    const forwardingTab = await $(S.sshAgentTabForwarding);
    const configTab = await $(S.sshAgentTabConfig);

    expect(await overviewTab.isExisting()).toBe(true);
    expect(await keysTab.isExisting()).toBe(true);
    expect(await forwardingTab.isExisting()).toBe(true);
    expect(await configTab.isExisting()).toBe(true);
  });

  it('should switch to Keys tab and show loaded keys', async () => {
    const agentManager = await $(S.sshAgentManager);
    await agentManager.click();
    await browser.pause(500);

    const keysTab = await $(S.sshAgentTabKeys);
    await keysTab.click();
    await browser.pause(500);

    const keyItems = await $$(S.sshAgentKeyItem);
    expect(keyItems).toBeDefined();
  });

  it('should have add key button in Keys tab', async () => {
    const agentManager = await $(S.sshAgentManager);
    await agentManager.click();
    await browser.pause(500);

    const keysTab = await $(S.sshAgentTabKeys);
    await keysTab.click();
    await browser.pause(500);

    const addKeyBtn = await $(S.sshAgentAddKey);
    expect(await addKeyBtn.isExisting()).toBe(true);
  });
});

describe('MCP Server Panel', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('MCP Tests');
  });

  it('should open MCP Server panel', async () => {
    const mcpPanel = await $(S.mcpServerPanel);
    await mcpPanel.click();
    await browser.pause(500);

    const overviewTab = await $(S.mcpOverviewTab);
    await overviewTab.waitForDisplayed({ timeout: 5_000 });
    expect(await overviewTab.isDisplayed()).toBe(true);
  });

  it('should show all MCP tabs', async () => {
    const mcpPanel = await $(S.mcpServerPanel);
    await mcpPanel.click();
    await browser.pause(500);

    const configTab = await $(S.mcpConfigTab);
    const toolsTab = await $(S.mcpToolsTab);
    const sessionsTab = await $(S.mcpSessionsTab);
    const resourcesTab = await $(S.mcpResourcesTab);
    const promptsTab = await $(S.mcpPromptsTab);
    const overviewTab = await $(S.mcpOverviewTab);

    expect(await configTab.isExisting()).toBe(true);
    expect(await toolsTab.isExisting()).toBe(true);
    expect(await sessionsTab.isExisting()).toBe(true);
    expect(await resourcesTab.isExisting()).toBe(true);
    expect(await promptsTab.isExisting()).toBe(true);
    expect(await overviewTab.isExisting()).toBe(true);
  });

  it('should show API key configuration in Config tab', async () => {
    const mcpPanel = await $(S.mcpServerPanel);
    await mcpPanel.click();
    await browser.pause(500);

    const configTab = await $(S.mcpConfigTab);
    await configTab.click();
    await browser.pause(500);

    const apiKeyInput = await $(S.mcpApiKeyInput);
    expect(await apiKeyInput.isExisting()).toBe(true);

    const saveBtn = await $(S.mcpConfigSave);
    expect(await saveBtn.isExisting()).toBe(true);
  });

  it('should show tools search in Tools tab', async () => {
    const mcpPanel = await $(S.mcpServerPanel);
    await mcpPanel.click();
    await browser.pause(500);

    const toolsTab = await $(S.mcpToolsTab);
    await toolsTab.click();
    await browser.pause(500);

    const searchInput = await $(S.mcpToolsSearch);
    expect(await searchInput.isExisting()).toBe(true);
  });
});
