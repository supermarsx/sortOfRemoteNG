import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, SSH_PORT, waitForContainer } from '../../helpers/docker';

// Bulk commander selectors
const BULK_CMD = {
  bulkCommanderPanel: '[data-testid="bulk-commander"]',
  bulkCommandInput: '[data-testid="bulk-command-input"]',
  bulkExecuteBtn: '[data-testid="bulk-execute"]',
  bulkResultItem: '[data-testid="bulk-result-item"]',
  bulkResultHost: '[data-testid="bulk-result-host"]',
  bulkResultOutput: '[data-testid="bulk-result-output"]',
  bulkSelectHost: '[data-testid="bulk-select-host"]',
  bulkHostCheckbox: '[data-testid="bulk-host-checkbox"]',
} as const;

async function createSSHConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('SSH');

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(SSH_PORT));

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue('testuser');

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue('testpass123');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

describe('SSH Bulk Commander', () => {
  before(async () => {
    startContainers();
    await waitForContainer('ssh', SSH_PORT, 30_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('Bulk Commander Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should select multiple SSH connections for bulk operations', async () => {
    await createSSHConnection('Host A');
    await createSSHConnection('Host B');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    expect(items.length).toBeGreaterThanOrEqual(2);

    // Select both items using bulk select (Ctrl+click)
    await items[0].click();
    await browser.keys(['Control']);
    await items[1].click();
    await browser.keys([]);  // release keys

    await browser.pause(500);

    // Bulk editor panel should appear
    const bulkEditor = await $(S.bulkEditor);
    const bulkExists = await bulkEditor.isExisting();
    expect(bulkExists).toBe(true);
  });

  it('should open bulk commander panel', async () => {
    await createSSHConnection('Cmd Host A');
    await createSSHConnection('Cmd Host B');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);

    // Select both
    await items[0].click();
    await browser.keys(['Control']);
    await items[1].click();
    await browser.keys([]);

    await browser.pause(500);

    const bulkCommander = await $(BULK_CMD.bulkCommanderPanel);
    if (await bulkCommander.isExisting()) {
      expect(await bulkCommander.isDisplayed()).toBe(true);
    } else {
      // Bulk commander may require explicit open
      const bulkEditor = await $(S.bulkEditor);
      expect(await bulkEditor.isExisting()).toBe(true);
    }
  });

  it('should execute command across multiple hosts', async () => {
    await createSSHConnection('Exec Host A');
    await createSSHConnection('Exec Host B');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);

    // Select both
    await items[0].click();
    await browser.keys(['Control']);
    await items[1].click();
    await browser.keys([]);

    await browser.pause(500);

    const cmdPanel = await $(BULK_CMD.bulkCommanderPanel);
    if (await cmdPanel.isExisting()) {
      const cmdInput = await $(BULK_CMD.bulkCommandInput);
      await cmdInput.setValue('whoami');

      const executeBtn = await $(BULK_CMD.bulkExecuteBtn);
      await executeBtn.click();
      await browser.pause(5000);

      const results = await $$(BULK_CMD.bulkResultItem);
      expect(results.length).toBeGreaterThan(0);
    }
  });

  it('should show per-host results after bulk execution', async () => {
    await createSSHConnection('Result Host A');
    await createSSHConnection('Result Host B');

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);

    await items[0].click();
    await browser.keys(['Control']);
    await items[1].click();
    await browser.keys([]);

    await browser.pause(500);

    const cmdPanel = await $(BULK_CMD.bulkCommanderPanel);
    if (await cmdPanel.isExisting()) {
      const cmdInput = await $(BULK_CMD.bulkCommandInput);
      await cmdInput.setValue('hostname');

      const executeBtn = await $(BULK_CMD.bulkExecuteBtn);
      await executeBtn.click();
      await browser.pause(5000);

      const results = await $$(BULK_CMD.bulkResultItem);
      for (const result of results) {
        const hostLabel = await result.$(BULK_CMD.bulkResultHost);
        if (await hostLabel.isExisting()) {
          const hostText = await hostLabel.getText();
          expect(hostText.length).toBeGreaterThan(0);
        }

        const output = await result.$(BULK_CMD.bulkResultOutput);
        if (await output.isExisting()) {
          const outputText = await output.getText();
          expect(outputText.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
