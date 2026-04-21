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

describe('Bulk Operations', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createTestConnection('BulkA', '10.0.0.1', 'SSH');
    await createTestConnection('BulkB', '10.0.0.2', 'RDP');
    await createTestConnection('BulkC', '10.0.0.3', 'HTTP');
  });

  it('should open bulk editor and show table view', async () => {
    const bulkBtn = await $('[data-testid="bulk-editor-btn"]');
    await bulkBtn.waitForDisplayed({ timeout: 3_000 });
    await bulkBtn.click();

    const bulkEditor = await $(S.bulkEditor);
    await bulkEditor.waitForDisplayed({ timeout: 5_000 });
    expect(await bulkEditor.isDisplayed()).toBe(true);

    const rows = await $$('[data-testid="bulk-editor-row"]');
    expect(rows.length).toBe(3);
  });

  it('should select multiple connections via checkboxes', async () => {
    const bulkBtn = await $('[data-testid="bulk-editor-btn"]');
    await bulkBtn.click();

    const bulkEditor = await $(S.bulkEditor);
    await bulkEditor.waitForDisplayed({ timeout: 5_000 });

    const checkboxes = await $$('[data-testid="bulk-editor-checkbox"]');
    expect(checkboxes.length).toBe(3);

    // Select first two
    await checkboxes[0].click();
    await checkboxes[1].click();
    await browser.pause(300);

    expect(await checkboxes[0].isSelected()).toBe(true);
    expect(await checkboxes[1].isSelected()).toBe(true);
    expect(await checkboxes[2].isSelected()).toBe(false);
  });

  it('should select all via select-all checkbox', async () => {
    const bulkBtn = await $('[data-testid="bulk-editor-btn"]');
    await bulkBtn.click();

    const bulkEditor = await $(S.bulkEditor);
    await bulkEditor.waitForDisplayed({ timeout: 5_000 });

    const selectAll = await $(S.bulkSelectAll);
    await selectAll.click();
    await browser.pause(300);

    const checkboxes = await $$('[data-testid="bulk-editor-checkbox"]');
    for (const cb of checkboxes) {
      expect(await cb.isSelected()).toBe(true);
    }
  });

  it('should bulk duplicate selected connections', async () => {
    const bulkBtn = await $('[data-testid="bulk-editor-btn"]');
    await bulkBtn.click();

    const bulkEditor = await $(S.bulkEditor);
    await bulkEditor.waitForDisplayed({ timeout: 5_000 });

    // Select first two
    const checkboxes = await $$('[data-testid="bulk-editor-checkbox"]');
    await checkboxes[0].click();
    await checkboxes[1].click();
    await browser.pause(300);

    const duplicateBtn = await $(S.bulkDuplicate);
    await duplicateBtn.waitForDisplayed({ timeout: 3_000 });
    await duplicateBtn.click();
    await browser.pause(500);

    // Should now have 5 rows (3 originals + 2 duplicates)
    const rows = await $$('[data-testid="bulk-editor-row"]');
    expect(rows.length).toBe(5);
  });

  it('should bulk delete with confirmation', async () => {
    const bulkBtn = await $('[data-testid="bulk-editor-btn"]');
    await bulkBtn.click();

    const bulkEditor = await $(S.bulkEditor);
    await bulkEditor.waitForDisplayed({ timeout: 5_000 });

    // Select all
    const selectAll = await $(S.bulkSelectAll);
    await selectAll.click();
    await browser.pause(300);

    const deleteBtn = await $(S.bulkDelete);
    await deleteBtn.waitForDisplayed({ timeout: 3_000 });
    await deleteBtn.click();

    // Confirmation dialog should appear
    const dialog = await $(S.confirmDialog);
    await dialog.waitForDisplayed({ timeout: 3_000 });
    expect(await dialog.isDisplayed()).toBe(true);

    const confirmYes = await $(S.confirmYes);
    await confirmYes.click();
    await browser.pause(500);

    // All connections should be removed
    const rows = await $$('[data-testid="bulk-editor-row"]');
    expect(rows.length).toBe(0);
  });

  it('should search within bulk editor', async () => {
    const bulkBtn = await $('[data-testid="bulk-editor-btn"]');
    await bulkBtn.click();

    const bulkEditor = await $(S.bulkEditor);
    await bulkEditor.waitForDisplayed({ timeout: 5_000 });

    const searchInput = await $('[data-testid="bulk-editor-search"]');
    await searchInput.waitForDisplayed({ timeout: 3_000 });
    await searchInput.setValue('BulkA');
    await browser.pause(500);

    const rows = await $$('[data-testid="bulk-editor-row"]');
    expect(rows.length).toBe(1);

    const rowText = await rows[0].getText();
    expect(rowText).toContain('BulkA');
  });
});
