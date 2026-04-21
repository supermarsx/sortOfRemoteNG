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

async function selectConnection(name: string): Promise<void> {
  const items = await $$(S.connectionItem);
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(name)) {
      await item.click();
      await browser.pause(300);
      return;
    }
  }
  throw new Error(`Connection "${name}" not found in tree`);
}

async function getConnectionNames(): Promise<string[]> {
  const items = await $$(S.connectionItem);
  return items.map((item) => item.getText());
}

describe('Connection Deletion', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createTestConnection('ToDelete', '192.168.1.1', 'SSH');
    await createTestConnection('ToKeep', '192.168.1.2', 'RDP');
  });

  it('should show confirmation dialog when deleting a connection', async () => {
    await selectConnection('ToDelete');

    const deleteBtn = await $('[data-testid="delete-connection"]');
    await deleteBtn.waitForDisplayed({ timeout: 3_000 });
    await deleteBtn.click();

    const dialog = await $(S.confirmDialog);
    await dialog.waitForDisplayed({ timeout: 3_000 });
    expect(await dialog.isDisplayed()).toBe(true);
  });

  it('should remove connection from tree on confirm', async () => {
    await selectConnection('ToDelete');

    const deleteBtn = await $('[data-testid="delete-connection"]');
    await deleteBtn.click();

    const confirmYes = await $(S.confirmYes);
    await confirmYes.waitForDisplayed({ timeout: 3_000 });
    await confirmYes.click();
    await browser.pause(500);

    const names = await getConnectionNames();
    expect(names).not.toContain('ToDelete');
    expect(names).toContain('ToKeep');
  });

  it('should keep connection when cancel is clicked in confirm dialog', async () => {
    await selectConnection('ToDelete');

    const deleteBtn = await $('[data-testid="delete-connection"]');
    await deleteBtn.click();

    const confirmNo = await $(S.confirmNo);
    await confirmNo.waitForDisplayed({ timeout: 3_000 });
    await confirmNo.click();
    await browser.pause(300);

    // Dialog should close
    const dialog = await $(S.confirmDialog);
    await dialog.waitForExist({ timeout: 3_000, reverse: true });

    const names = await getConnectionNames();
    expect(names).toContain('ToDelete');
    expect(names).toContain('ToKeep');
  });

  it('should delete a group and all its children', async () => {
    // Create a group with children
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    await (await $(S.editorName)).setValue('Child1');
    await (await $(S.editorHostname)).setValue('10.0.0.1');
    await (await $(S.editorProtocol)).selectByVisibleText('SSH');

    const parentFolder = await $(S.editorParentFolder);
    if (await parentFolder.isExisting()) {
      await parentFolder.selectByVisibleText('TestGroup');
    }

    await (await $(S.editorSave)).click();
    await browser.pause(500);

    // Select the group and delete it
    const groups = await $$(S.connectionGroup);
    for (const group of groups) {
      const text = await group.getText();
      if (text.includes('TestGroup')) {
        await group.click();
        break;
      }
    }

    const deleteBtn = await $('[data-testid="delete-connection"]');
    await deleteBtn.waitForDisplayed({ timeout: 3_000 });
    await deleteBtn.click();

    const confirmYes = await $(S.confirmYes);
    await confirmYes.waitForDisplayed({ timeout: 3_000 });
    await confirmYes.click();
    await browser.pause(500);

    // Group and children should be gone
    const names = await getConnectionNames();
    expect(names).not.toContain('Child1');

    const remainingGroups = await $$(S.connectionGroup);
    const groupTexts = await remainingGroups.map((g) => g.getText());
    const hasTestGroup = groupTexts.some((t) => t.includes('TestGroup'));
    expect(hasTestGroup).toBe(false);
  });
});
