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

describe('Connection Search', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createTestConnection('ProdWeb', 'prod-web.example.com', 'HTTP');
    await createTestConnection('ProdDB', 'prod-db.example.com', 'SSH');
    await createTestConnection('StagingAPI', 'staging-api.local', 'HTTP');
  });

  it('should filter connections by name when typing in search', async () => {
    const searchInput = await $(S.sidebarSearch);
    await searchInput.waitForDisplayed({ timeout: 5_000 });
    await searchInput.setValue('Prod');
    await browser.pause(500);

    const items = await $$(S.connectionItem);
    const names = await items.map((i) => i.getText());

    expect(names.some((n) => n.includes('ProdWeb'))).toBe(true);
    expect(names.some((n) => n.includes('ProdDB'))).toBe(true);
    expect(names.some((n) => n.includes('StagingAPI'))).toBe(false);
  });

  it('should filter connections by hostname', async () => {
    const searchInput = await $(S.sidebarSearch);
    await searchInput.waitForDisplayed({ timeout: 5_000 });
    await searchInput.setValue('staging-api');
    await browser.pause(500);

    const items = await $$(S.connectionItem);
    const names = await items.map((i) => i.getText());

    expect(names.some((n) => n.includes('StagingAPI'))).toBe(true);
    expect(names.some((n) => n.includes('ProdWeb'))).toBe(false);
    expect(names.some((n) => n.includes('ProdDB'))).toBe(false);
  });

  it('should show all connections when search is cleared', async () => {
    const searchInput = await $(S.sidebarSearch);
    await searchInput.waitForDisplayed({ timeout: 5_000 });

    // Filter first
    await searchInput.setValue('ProdDB');
    await browser.pause(500);

    let items = await $$(S.connectionItem);
    expect(items.length).toBe(1);

    // Clear search
    await searchInput.clearValue();
    await browser.pause(500);

    items = await $$(S.connectionItem);
    const names = await items.map((i) => i.getText());
    expect(names.some((n) => n.includes('ProdWeb'))).toBe(true);
    expect(names.some((n) => n.includes('ProdDB'))).toBe(true);
    expect(names.some((n) => n.includes('StagingAPI'))).toBe(true);
  });

  it('should toggle sort direction', async () => {
    const sortBtn = await $('[data-testid="sort-connections"]');
    await sortBtn.waitForDisplayed({ timeout: 3_000 });
    await sortBtn.click();

    const sortByName = await $('[data-testid="sort-by-name"]');
    await sortByName.waitForDisplayed({ timeout: 3_000 });
    await sortByName.click();
    await browser.pause(500);

    // Get ascending order
    let items = await $$(S.connectionItem);
    const ascNames = await items.map((i) => i.getText());

    // Toggle direction
    const directionToggle = await $('[data-testid="sort-direction"]');
    await directionToggle.waitForDisplayed({ timeout: 3_000 });
    await directionToggle.click();
    await browser.pause(500);

    items = await $$(S.connectionItem);
    const descNames = await items.map((i) => i.getText());

    // The orders should be reversed
    expect(ascNames).toEqual([...descNames].reverse());
  });
});
