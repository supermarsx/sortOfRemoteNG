import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

const NEW_CONNECTION_BUTTON =
  '//div[@data-testid="welcome-screen"]//button[.//span[normalize-space()="New Connection"]]';
const TREE_ITEM_MENU = '[data-testid="connection-tree-item-menu"]';
const CHECK_MODAL = '[data-testid="check-connections-modal"]';
const CHECK_ROWS = '[data-testid="check-connections-row"]';
const CHECK_CANCEL = '[data-testid="check-connections-cancel"]';
const CHECK_CLOSE = '[data-testid="check-connections-close"]';

async function getTreeItemByName(name: string) {
  const items = await $$(S.connectionItem);

  for (const item of items) {
    if ((await item.getText()).trim() === name) {
      return item;
    }
  }

  throw new Error(`Connection "${name}" not found in tree`);
}

async function listConnectionNames(): Promise<string[]> {
  const items = await $$(S.connectionItem);
  const names: string[] = [];

  for (const item of items) {
    names.push((await item.getText()).trim());
  }

  return names;
}

async function waitForConnectionName(name: string): Promise<void> {
  await browser.waitUntil(
    async () => (await listConnectionNames()).includes(name),
    {
      timeout: 10_000,
      timeoutMsg: `Expected tree item "${name}" to appear`,
    },
  );
}

async function findVisibleEditor(name?: string): Promise<WebdriverIO.Element> {
  const editors = await $$(S.editorPanel);

  for (const editor of editors) {
    if (!(await editor.isDisplayed().catch(() => false))) {
      continue;
    }

    if (!name) {
      return editor;
    }

    const nameInput = await editor.$(S.editorName);
    if (!(await nameInput.isExisting().catch(() => false))) {
      continue;
    }

    if ((await nameInput.getValue()) === name) {
      return editor;
    }
  }

  throw new Error(name ? `Visible editor for "${name}" not found` : 'Visible editor not found');
}

async function waitForVisibleEditor(name?: string): Promise<WebdriverIO.Element> {
  await browser.waitUntil(
    async () => {
      try {
        await findVisibleEditor(name);
        return true;
      } catch {
        return false;
      }
    },
    {
      timeout: 10_000,
      timeoutMsg: name
        ? `Expected visible editor for connection "${name}"`
        : 'Expected a visible connection editor',
    },
  );

  return findVisibleEditor(name);
}

async function openNewConnectionEditor(): Promise<WebdriverIO.Element> {
  const toolbarButton = await $(S.toolbarNewConnection);
  if (await toolbarButton.isExisting().catch(() => false)) {
    await toolbarButton.waitForClickable({ timeout: 10_000 });
    await toolbarButton.click();
  } else {
    const button = await $(NEW_CONNECTION_BUTTON);
    await button.waitForClickable({ timeout: 10_000 });
    await button.click();
  }

  const editor = await waitForVisibleEditor();
  const hostnameInput = await editor.$(S.editorHostname);
  await hostnameInput.waitForExist({ timeout: 10_000 });

  return editor;
}

async function createSeedConnection(name: string): Promise<void> {
  const editor = await openNewConnectionEditor();

  await (await editor.$(S.editorName)).setValue(name);
  await (await editor.$(S.editorHostname)).setValue('127.0.0.1');

  const portInput = await editor.$(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue('1');

  const usernameInput = await editor.$(S.editorUsername);
  await usernameInput.setValue('clone-user');

  const passwordInput = await editor.$(S.editorPassword);
  await passwordInput.setValue('SuperSecret123!');

  await (await editor.$(S.editorSave)).click();
  await waitForConnectionName(name);
}

async function openConnectionEditor(name: string): Promise<WebdriverIO.Element> {
  await openContextMenuForConnection(name);
  await clickTreeMenuItem('Edit');

  return waitForVisibleEditor(name);
}

async function openContextMenuForConnection(name: string): Promise<void> {
  const item = await getTreeItemByName(name);
  await item.click({ button: 'right' });

  await (await $(TREE_ITEM_MENU)).waitForDisplayed({ timeout: 10_000 });
}

async function clickTreeMenuItem(label: string): Promise<void> {
  const menu = await $(TREE_ITEM_MENU);
  const option = await menu.$(`.//button[normalize-space()="${label}"]`);
  await option.waitForClickable({ timeout: 10_000 });
  await option.click();
}

async function getEditorCredentialValues(editor: WebdriverIO.Element): Promise<{ username: string; password: string }> {
  const usernameInput = await editor.$(S.editorUsername);
  const passwordInput = await editor.$(S.editorPassword);

  return {
    username: await usernameInput.getValue(),
    password: await passwordInput.getValue(),
  };
}

describe('Collections Clone And Check', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Clone And Check');

    const tree = await $(S.connectionTree);
    await tree.waitForDisplayed({ timeout: 10_000 });

    await createSeedConnection('Clone Target');
  });

  it('clones a connection with the default secret-stripping behavior', async () => {
    const originalEditor = await openConnectionEditor('Clone Target');

    const originalCredentials = await getEditorCredentialValues(originalEditor);
    expect(originalCredentials.username).toBe('clone-user');
    expect(originalCredentials.password).toBe('SuperSecret123!');

    await openContextMenuForConnection('Clone Target');
    await clickTreeMenuItem('Clone');

    await waitForConnectionName('Clone Target (Copy)');
    expect(await listConnectionNames()).toContain('Clone Target (Copy)');

    const clonedEditor = await openConnectionEditor('Clone Target (Copy)');
    expect(await (await clonedEditor.$(S.editorName)).getValue()).toBe('Clone Target (Copy)');

    const clonedCredentials = await getEditorCredentialValues(clonedEditor);
    expect(clonedCredentials.username).toBe('clone-user');
    expect(clonedCredentials.password).toBe('');
  });

  it('opens the reachability check modal from the tree context menu', async () => {
    await openContextMenuForConnection('Clone Target');
    await clickTreeMenuItem('Check connection');

    const modal = await $(CHECK_MODAL);
    await modal.waitForDisplayed({ timeout: 10_000 });

    await browser.waitUntil(
      async () => {
        const rows = await $$(CHECK_ROWS);
        return (await rows.length) > 0;
      },
      {
        timeout: 10_000,
        timeoutMsg: 'Expected at least one reachability row',
      },
    );

    const modalText = await modal.getText();
    expect(modalText).toContain('Reachability check');
    expect(modalText).toContain('Clone Target');
    expect(
      ['Pending', 'Probing', 'Reachable', 'Refused', 'Timeout', 'Error'].some((label) =>
        modalText.includes(label),
      ),
    ).toBe(true);

    const cancelButton = await $(CHECK_CANCEL);
    const closeButton = await $(CHECK_CLOSE);

    if (await cancelButton.isEnabled()) {
      await cancelButton.click();
      await browser.waitUntil(
        async () => await closeButton.isEnabled(),
        {
          timeout: 10_000,
          timeoutMsg: 'Expected reachability modal to become closable after cancellation',
        },
      );
    }

    await closeButton.click();
    await modal.waitForExist({ timeout: 10_000, reverse: true });
  });
});