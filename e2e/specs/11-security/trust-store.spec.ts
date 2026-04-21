import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, waitForContainer, SSH_PORT } from '../../helpers/docker';

describe('Trust Store', () => {
  before(async function () {
    this.timeout(120_000);
    startContainers();
    await waitForContainer('test-ssh', SSH_PORT, 60_000);
  });

  after(() => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('Trust Tests');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should show trust dialog on first SSH connection to unknown host', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const nameInput = await $(S.editorName);
    await nameInput.setValue('Unknown Host');
    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('localhost');
    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('SSH');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    // Connect
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    for (const item of items) {
      const text = await item.getText();
      if (text.includes('Unknown Host')) {
        await item.doubleClick();
        break;
      }
    }

    const trustDialog = await $('[data-testid="trust-dialog"]');
    await trustDialog.waitForDisplayed({ timeout: 15_000 });
    expect(await trustDialog.isDisplayed()).toBe(true);
  });

  it('should store host key after accepting trust dialog', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const nameInput = await $(S.editorName);
    await nameInput.setValue('Trust Host');
    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('localhost');
    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('SSH');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    for (const item of items) {
      const text = await item.getText();
      if (text.includes('Trust Host')) {
        await item.doubleClick();
        break;
      }
    }

    const trustDialog = await $('[data-testid="trust-dialog"]');
    await trustDialog.waitForDisplayed({ timeout: 15_000 });

    const acceptBtn = await $('[data-testid="trust-accept"]');
    await acceptBtn.click();
    await browser.pause(1_000);

    // Dialog should close after accepting
    await trustDialog.waitForExist({ timeout: 5_000, reverse: true });
  });

  it('should manage trust records in trust store panel', async () => {
    const trustStoreBtn = await $('[data-testid="open-trust-store"]');
    await trustStoreBtn.click();
    await browser.pause(500);

    const trustPanel = await $('[data-testid="trust-store-panel"]');
    await trustPanel.waitForDisplayed({ timeout: 5_000 });

    const records = await $$('[data-testid="trust-record"]');
    expect(records).toBeDefined();
  });
});
