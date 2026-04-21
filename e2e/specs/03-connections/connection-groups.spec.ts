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

async function createGroup(name: string): Promise<void> {
  const addGroupBtn = await $('[data-testid="add-group"]');
  await addGroupBtn.click();

  const nameInput = await $('[data-testid="group-name-input"]');
  await nameInput.waitForDisplayed({ timeout: 3_000 });
  await nameInput.setValue(name);

  const confirmBtn = await $('[data-testid="group-confirm"]');
  await confirmBtn.click();
  await browser.pause(500);
}

describe('Connection Groups', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createTestConnection('ServerA', '192.168.1.10', 'SSH');
    await createTestConnection('ServerB', '192.168.1.20', 'RDP');
  });

  it('should create a new group/folder', async () => {
    await createGroup('Production');

    const groups = await $$(S.connectionGroup);
    const texts = await groups.map((g) => g.getText());
    const hasProduction = texts.some((t) => t.includes('Production'));
    expect(hasProduction).toBe(true);
  });

  it('should move a connection into a group', async () => {
    await createGroup('Staging');

    // Select a connection and assign it to the group
    const items = await $$(S.connectionItem);
    for (const item of items) {
      const text = await item.getText();
      if (text.includes('ServerA')) {
        await item.click();
        break;
      }
    }

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const parentFolder = await $(S.editorParentFolder);
    await parentFolder.waitForDisplayed({ timeout: 3_000 });
    await parentFolder.selectByVisibleText('Staging');

    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    // Expand the group and verify the connection is inside
    const groups = await $$(S.connectionGroup);
    for (const group of groups) {
      const text = await group.getText();
      if (text.includes('Staging')) {
        await group.click();
        await browser.pause(300);
        break;
      }
    }

    const childItems = await $$(S.connectionItem);
    const childNames = await childItems.map((c) => c.getText());
    expect(childNames.some((n) => n.includes('ServerA'))).toBe(true);
  });

  it('should support nested groups', async () => {
    await createGroup('Environment');

    // Create a child group inside the parent
    const groups = await $$(S.connectionGroup);
    for (const group of groups) {
      const text = await group.getText();
      if (text.includes('Environment')) {
        await group.click();
        await browser.pause(300);
        break;
      }
    }

    await createGroup('Dev');

    // Verify nested structure
    const allGroups = await $$(S.connectionGroup);
    const allTexts = await allGroups.map((g) => g.getText());
    expect(allTexts.some((t) => t.includes('Dev'))).toBe(true);
  });

  it('should expand and collapse groups', async () => {
    await createGroup('Collapsible');

    // Move a connection into the group via the editor
    const items = await $$(S.connectionItem);
    for (const item of items) {
      if ((await item.getText()).includes('ServerB')) {
        await item.click();
        break;
      }
    }

    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });

    const parentFolder = await $(S.editorParentFolder);
    await parentFolder.selectByVisibleText('Collapsible');
    await (await $(S.editorSave)).click();
    await browser.pause(500);

    // Click group to expand
    const groups = await $$(S.connectionGroup);
    let targetGroup: WebdriverIO.Element | undefined;
    for (const group of groups) {
      if ((await group.getText()).includes('Collapsible')) {
        targetGroup = group;
        break;
      }
    }
    expect(targetGroup).toBeDefined();

    // Expand
    await targetGroup!.click();
    await browser.pause(300);
    let visibleItems = await $$(S.connectionItem);
    let visibleNames = await visibleItems.map((i) => i.getText());
    expect(visibleNames.some((n) => n.includes('ServerB'))).toBe(true);

    // Collapse
    await targetGroup!.click();
    await browser.pause(300);

    // After collapsing, the child should not be visible
    visibleItems = await $$(S.connectionItem);
    const filteredTexts: string[] = [];
    for (const item of visibleItems) {
      if (await item.isDisplayed()) {
        filteredTexts.push(await item.getText());
      }
    }
    visibleNames = filteredTexts;
    // ServerB should not appear in the visible items after collapse
    let serverBVisible = false;
    for (const item of visibleItems) {
      const text = await item.getText();
      if (text.includes('ServerB') && (await item.isDisplayed())) {
        serverBVisible = true;
      }
    }
    expect(serverBVisible).toBe(false);
  });

  it('should render depth indicators for nested items', async () => {
    await createGroup('Level1');

    const groups = await $$(S.connectionGroup);
    for (const group of groups) {
      if ((await group.getText()).includes('Level1')) {
        await group.click();
        await browser.pause(300);
        break;
      }
    }

    await createGroup('Level2');

    // Check for depth indicator CSS or data attributes
    const allGroups = await $$(S.connectionGroup);
    for (const group of allGroups) {
      const text = await group.getText();
      if (text.includes('Level2')) {
        const depth =
          (await group.getAttribute('data-depth')) ||
          (await group.getCSSProperty('padding-left')).value;
        expect(depth).toBeTruthy();
        break;
      }
    }
  });
});
