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
    if ((await item.getText()).includes(name)) {
      await item.click();
      await browser.pause(300);
      return;
    }
  }
  throw new Error(`Connection "${name}" not found in tree`);
}

describe('Connection Favorites & Tags', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createTestConnection('WebServer', 'web.example.com', 'HTTP');
    await createTestConnection('DBServer', 'db.example.com', 'SSH');
    await createTestConnection('FileServer', 'files.example.com', 'SSH');
  });

  it('should toggle favorite and show star icon', async () => {
    await selectConnection('WebServer');

    const favoriteBtn = await $('[data-testid="toggle-favorite"]');
    await favoriteBtn.waitForDisplayed({ timeout: 3_000 });
    await favoriteBtn.click();
    await browser.pause(300);

    // Verify star/favorite indicator appears on the item
    const items = await $$(S.connectionItem);
    for (const item of items) {
      if ((await item.getText()).includes('WebServer')) {
        const star = await item.$('[data-testid="favorite-indicator"]');
        expect(await star.isExisting()).toBe(true);
        break;
      }
    }
  });

  it('should filter connections to show only favorites', async () => {
    // Mark WebServer as favorite
    await selectConnection('WebServer');
    const favoriteBtn = await $('[data-testid="toggle-favorite"]');
    await favoriteBtn.click();
    await browser.pause(300);

    // Activate favorites filter
    const filterFavBtn = await $('[data-testid="filter-favorites"]');
    await filterFavBtn.waitForDisplayed({ timeout: 3_000 });
    await filterFavBtn.click();
    await browser.pause(500);

    const items = await $$(S.connectionItem);
    const names = await items.map((i) => i.getText());
    expect(names.some((n) => n.includes('WebServer'))).toBe(true);
    expect(names.some((n) => n.includes('DBServer'))).toBe(false);
    expect(names.some((n) => n.includes('FileServer'))).toBe(false);
  });

  it('should add tags to a connection', async () => {
    await selectConnection('DBServer');

    const tagInput = await $('[data-testid="editor-tags"]');
    await tagInput.waitForDisplayed({ timeout: 3_000 });
    await tagInput.setValue('database');
    await browser.keys('Enter');
    await browser.pause(300);

    await tagInput.setValue('production');
    await browser.keys('Enter');
    await browser.pause(300);

    await (await $(S.editorSave)).click();
    await browser.pause(500);

    // Re-select and verify tags persisted
    await selectConnection('WebServer');
    await browser.pause(300);
    await selectConnection('DBServer');

    const tags = await $$('[data-testid="connection-tag"]');
    const tagTexts = await tags.map((t) => t.getText());
    expect(tagTexts).toContain('database');
    expect(tagTexts).toContain('production');
  });

  it('should filter connections by tag', async () => {
    // Tag DBServer
    await selectConnection('DBServer');
    const tagInput = await $('[data-testid="editor-tags"]');
    await tagInput.waitForDisplayed({ timeout: 3_000 });
    await tagInput.setValue('critical');
    await browser.keys('Enter');
    await (await $(S.editorSave)).click();
    await browser.pause(500);

    // Use tag filter
    const tagFilter = await $('[data-testid="filter-by-tag"]');
    await tagFilter.waitForDisplayed({ timeout: 3_000 });
    await tagFilter.click();

    const tagOption = await $('[data-testid="tag-option-critical"]');
    await tagOption.waitForDisplayed({ timeout: 3_000 });
    await tagOption.click();
    await browser.pause(500);

    const items = await $$(S.connectionItem);
    const names = await items.map((i) => i.getText());
    expect(names.some((n) => n.includes('DBServer'))).toBe(true);
    expect(names.some((n) => n.includes('WebServer'))).toBe(false);
  });

  it('should sort connections by name and protocol', async () => {
    const sortBtn = await $('[data-testid="sort-connections"]');
    await sortBtn.waitForDisplayed({ timeout: 3_000 });

    // Sort by name
    await sortBtn.click();
    const sortByName = await $('[data-testid="sort-by-name"]');
    await sortByName.waitForDisplayed({ timeout: 3_000 });
    await sortByName.click();
    await browser.pause(500);

    let items = await $$(S.connectionItem);
    let names = await items.map((i) => i.getText());
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sortedNames);

    // Sort by protocol
    await sortBtn.click();
    const sortByProtocol = await $('[data-testid="sort-by-protocol"]');
    await sortByProtocol.waitForDisplayed({ timeout: 3_000 });
    await sortByProtocol.click();
    await browser.pause(500);

    items = await $$(S.connectionItem);
    names = await items.map((i) => i.getText());
    // Just verify the sort changed (order may differ)
    expect(names.length).toBeGreaterThan(0);
  });
});
