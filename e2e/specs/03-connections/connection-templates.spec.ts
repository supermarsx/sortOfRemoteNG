import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

async function createTestConnection(
  name: string,
  hostname: string,
  protocol: string,
): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  await (await $(S.editorName)).setValue(name);
  await (await $(S.editorHostname)).setValue(hostname);
  await (await $(S.editorProtocol)).selectByVisibleText(protocol);

  await (await $(S.editorSave)).click();
  await browser.pause(500);
}

describe('Connection Templates', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createTestConnection('BaseSSH', '10.0.0.1', 'SSH');
    await createTestConnection('BaseRDP', '10.0.0.2', 'RDP');
  });

  it('should show built-in templates', async () => {
    const templatesBtn = await $('[data-testid="templates-btn"]');
    await templatesBtn.waitForDisplayed({ timeout: 3_000 });
    await templatesBtn.click();

    const templateList = await $(S.templateList);
    await templateList.waitForDisplayed({ timeout: 5_000 });

    const items = await $$(S.templateItem);
    expect(items.length).toBeGreaterThan(0);
  });

  it('should pre-fill fields when applying a template', async () => {
    const templatesBtn = await $('[data-testid="templates-btn"]');
    await templatesBtn.click();

    const templateList = await $(S.templateList);
    await templateList.waitForDisplayed({ timeout: 5_000 });

    // Select the first template
    const firstTemplate = await $(S.templateItem);
    await firstTemplate.click();

    const applyBtn = await $('[data-testid="template-apply"]');
    await applyBtn.waitForDisplayed({ timeout: 3_000 });
    await applyBtn.click();
    await browser.pause(500);

    // Editor should open with pre-filled fields
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const protocolSelect = await $(S.editorProtocol);
    const protocolValue = await protocolSelect.getValue();
    expect(protocolValue).toBeTruthy();

    const portInput = await $(S.editorPort);
    const portValue = await portInput.getValue();
    expect(portValue).toBeTruthy();
  });

  it('should create a custom template from an existing connection', async () => {
    // Select a connection
    const items = await $$(S.connectionItem);
    for (const item of items) {
      if ((await item.getText()).includes('BaseSSH')) {
        await item.click();
        break;
      }
    }

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    // Save as template
    const saveAsTemplateBtn = await $('[data-testid="save-as-template"]');
    await saveAsTemplateBtn.waitForDisplayed({ timeout: 3_000 });
    await saveAsTemplateBtn.click();

    const templateNameInput = await $('[data-testid="template-name-input"]');
    await templateNameInput.waitForDisplayed({ timeout: 3_000 });
    await templateNameInput.setValue('My SSH Template');

    const templateSaveBtn = await $('[data-testid="template-save"]');
    await templateSaveBtn.click();
    await browser.pause(500);

    // Verify it appears in the template list
    const templatesBtn = await $('[data-testid="templates-btn"]');
    await templatesBtn.click();

    const templateList = await $(S.templateList);
    await templateList.waitForDisplayed({ timeout: 5_000 });

    const templateItems = await $$(S.templateItem);
    const templateNames = await templateItems.map((t) => t.getText());
    expect(templateNames.some((n) => n.includes('My SSH Template'))).toBe(true);
  });

  it('should filter templates by category', async () => {
    const templatesBtn = await $('[data-testid="templates-btn"]');
    await templatesBtn.click();

    const templateList = await $(S.templateList);
    await templateList.waitForDisplayed({ timeout: 5_000 });

    // Click a category filter
    const categoryFilter = await $('[data-testid="template-category-filter"]');
    await categoryFilter.waitForDisplayed({ timeout: 3_000 });
    await categoryFilter.selectByVisibleText('SSH');
    await browser.pause(500);

    const items = await $$(S.templateItem);
    expect(items.length).toBeGreaterThan(0);

    // All visible templates should be SSH-related
    for (const item of items) {
      const text = await item.getText();
      expect(text.toLowerCase()).toContain('ssh');
    }
  });
});
