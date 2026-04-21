import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, MYSQL_PORT, waitForContainer } from '../../helpers/docker';

// MySQL client selectors
const MYSQL = {
  mysqlClient: '[data-testid="mysql-client"]',
  queryEditor: '[data-testid="mysql-query-editor"]',
  executeQueryBtn: '[data-testid="mysql-execute"]',
  queryResults: '[data-testid="mysql-results"]',
  resultRow: '[data-testid="mysql-result-row"]',
  resultCell: '[data-testid="mysql-result-cell"]',
  databaseList: '[data-testid="mysql-databases"]',
  tableList: '[data-testid="mysql-tables"]',
  statusIndicator: '[data-testid="mysql-status"]',
} as const;

async function createMySQLConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('MySQL');

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(MYSQL_PORT));

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue('testuser');

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue('testpass123');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function connectFirstItem(): Promise<void> {
  const tree = await $(S.connectionTree);
  const item = await tree.$(S.connectionItem);
  await item.doubleClick();
}

describe('MySQL Client', () => {
  before(async () => {
    startContainers();
    await waitForContainer('mysql', MYSQL_PORT, 60_000);
  });

  after(async () => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('MySQL Test');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should connect to MySQL server and open client', async () => {
    await createMySQLConnection('Test MySQL');
    await connectFirstItem();

    const client = await $(MYSQL.mysqlClient);
    await client.waitForDisplayed({ timeout: 20_000 });
    expect(await client.isDisplayed()).toBe(true);
  });

  it('should show connection status as connected', async () => {
    await createMySQLConnection('MySQL Status');
    await connectFirstItem();

    const client = await $(MYSQL.mysqlClient);
    await client.waitForDisplayed({ timeout: 20_000 });

    const status = await $(MYSQL.statusIndicator);
    if (await status.isExisting()) {
      const text = await status.getText();
      expect(text.toLowerCase()).toMatch(/connected|ready/);
    }
  });

  it('should display query editor', async () => {
    await createMySQLConnection('MySQL Editor');
    await connectFirstItem();

    const client = await $(MYSQL.mysqlClient);
    await client.waitForDisplayed({ timeout: 20_000 });

    const queryEditor = await $(MYSQL.queryEditor);
    const editorExists = await queryEditor.isExisting();
    expect(editorExists).toBe(true);
  });

  it('should execute SELECT query and display results', async () => {
    await createMySQLConnection('MySQL Query');
    await connectFirstItem();

    const client = await $(MYSQL.mysqlClient);
    await client.waitForDisplayed({ timeout: 20_000 });

    const queryEditor = await $(MYSQL.queryEditor);
    await queryEditor.click();
    await queryEditor.setValue('SELECT 1 AS result;');

    const executeBtn = await $(MYSQL.executeQueryBtn);
    await executeBtn.click();
    await browser.pause(3000);

    const results = await $(MYSQL.queryResults);
    await results.waitForDisplayed({ timeout: 10_000 });

    const rows = await $$(MYSQL.resultRow);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('should show testdb in database list', async () => {
    await createMySQLConnection('MySQL DB List');
    await connectFirstItem();

    const client = await $(MYSQL.mysqlClient);
    await client.waitForDisplayed({ timeout: 20_000 });

    // Execute SHOW DATABASES
    const queryEditor = await $(MYSQL.queryEditor);
    await queryEditor.click();
    await queryEditor.setValue('SHOW DATABASES;');

    const executeBtn = await $(MYSQL.executeQueryBtn);
    await executeBtn.click();
    await browser.pause(3000);

    const results = await $(MYSQL.queryResults);
    await results.waitForDisplayed({ timeout: 10_000 });
    const text = await results.getText();
    expect(text).toContain('testdb');
  });

  it('should show session tab when MySQL client is active', async () => {
    await createMySQLConnection('MySQL Tab');
    await connectFirstItem();

    const client = await $(MYSQL.mysqlClient);
    await client.waitForDisplayed({ timeout: 20_000 });

    const tabs = await $$(S.sessionTab);
    expect(tabs.length).toBeGreaterThan(0);
  });
});
