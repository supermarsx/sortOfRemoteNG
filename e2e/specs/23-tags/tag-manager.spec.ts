import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

async function addConnection(name: string, hostname: string, protocol: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue(hostname);

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText(protocol);

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

describe('Tag Manager', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Tag Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await addConnection('Prod Server', '10.0.0.1', 'SSH');
  });

  it('should add a tag to a connection', async () => {
    // Open editor for existing connection
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(500);

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const tagInput = await $(S.tagInput);
    await tagInput.setValue('production');

    const tagCreateBtn = await $(S.tagCreate);
    await tagCreateBtn.click();
    await browser.pause(300);

    const tags = await $$(S.tagChip);
    expect(tags.length).toBeGreaterThanOrEqual(1);

    const tagText = await tags[0].getText();
    expect(tagText).toContain('production');
  });

  it('should remove a tag from a connection', async () => {
    // Open editor and add tag
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(500);

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const tagInput = await $(S.tagInput);
    await tagInput.setValue('staging');

    const tagCreateBtn = await $(S.tagCreate);
    await tagCreateBtn.click();
    await browser.pause(300);

    const tags = await $$(S.tagChip);
    const initialCount = await tags.length;

    // Remove the tag
    const removeBtn = await tags[0].$(S.tagRemove);
    await removeBtn.click();
    await browser.pause(300);

    const remainingTags = await $$(S.tagChip);
    expect(remainingTags.length).toBe(initialCount - 1);
  });

  it('should add multiple tags to a connection', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(500);

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const tagInput = await $(S.tagInput);

    await tagInput.setValue('production');
    const tagCreateBtn = await $(S.tagCreate);
    await tagCreateBtn.click();
    await browser.pause(300);

    await tagInput.setValue('linux');
    await tagCreateBtn.click();
    await browser.pause(300);

    await tagInput.setValue('critical');
    await tagCreateBtn.click();
    await browser.pause(300);

    const tags = await $$(S.tagChip);
    expect(tags.length).toBe(3);
  });

  it('should persist tags after saving connection', async () => {
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(500);

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const tagInput = await $(S.tagInput);
    await tagInput.setValue('saved-tag');

    const tagCreateBtn = await $(S.tagCreate);
    await tagCreateBtn.click();
    await browser.pause(300);

    // Save the connection
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    // Re-open the editor
    const updatedItems = await tree.$$(S.connectionItem);
    await updatedItems[0].doubleClick();
    await browser.pause(500);

    const tags = await $$(S.tagChip);
    expect(tags.length).toBeGreaterThanOrEqual(1);
    const tagText = await tags[0].getText();
    expect(tagText).toContain('saved-tag');
  });
});
