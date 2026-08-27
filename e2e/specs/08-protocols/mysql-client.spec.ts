import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  closeAllSessions,
} from "../../helpers/app";
import {
  isDockerAvailable,
  startContainers,
  stopContainers,
  MYSQL_PORT,
  waitForContainer,
} from "../../helpers/docker";
import { selectCustomOption } from "../../helpers/forms";
import { openConnectionItem, waitForConnectionItem } from "../../helpers/ssh";

// Tier: opt-in (Docker). Fixture: compose service `test-mysql` (mysql:8),
// seeded by e2e/fixtures/db/mysql/01-seed.sql (table `people`, 5 rows).
// Credentials come from e2e/.env (MYSQL_USER / MYSQL_PASSWORD), defaulting to
// the .env.example values.
const MYSQL_USER = process.env.MYSQL_USER ?? "testuser";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD ?? "testpass";
const SERVICE = "test-mysql";

async function createMySQLConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue("127.0.0.1");

  await selectCustomOption(S.editorProtocol, ["MySQL / MariaDB", "MySQL"]);

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(MYSQL_PORT));

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue(MYSQL_USER);

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue(MYSQL_PASSWORD);

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await waitForConnectionItem(name);
}

async function openMySQLClient(name: string): Promise<void> {
  await createMySQLConnection(name);
  await openConnectionItem(name);

  const client = await $(S.mysqlClient);
  await client.waitForDisplayed({ timeout: 20_000 });

  const status = await $(S.mysqlStatus);
  await browser.waitUntil(
    async () => /connected|ready/i.test(await status.getText().catch(() => "")),
    {
      timeout: 20_000,
      timeoutMsg: "MySQL session did not reach connected state",
    },
  );
}

async function runQuery(sql: string): Promise<void> {
  const queryEditor = await $(S.mysqlQueryEditor);
  await queryEditor.click();
  await queryEditor.clearValue();
  await queryEditor.setValue(sql);

  const executeBtn = await $(S.mysqlExecute);
  await executeBtn.click();

  const results = await $(S.mysqlResults);
  await results.waitForDisplayed({ timeout: 15_000 });
  await browser.waitUntil(
    async () => Number(await (await $$(S.mysqlResultRow)).length) > 0,
    {
      timeout: 15_000,
      timeoutMsg: `No result rows for: ${sql}`,
    },
  );
}

describe("MySQL Client", function () {
  before(async function () {
    if (!isDockerAvailable()) {
      this.skip();
    }
    startContainers([SERVICE]);
    await waitForContainer(SERVICE, MYSQL_PORT, 120_000);
  });

  after(async () => {
    if (isDockerAvailable()) {
      stopContainers([SERVICE]);
    }
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("MySQL Test");
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("connects and shows the client with a connected status", async () => {
    await openMySQLClient("Test MySQL");

    const client = await $(S.mysqlClient);
    expect(await client.isDisplayed()).toBe(true);

    const tabs = await $$(S.sessionTab);
    expect(Number(await tabs.length)).toBeGreaterThan(0);
  });

  it("reports the detected dialect as MySQL", async () => {
    await openMySQLClient("MySQL Dialect");

    const badge = await $(S.mysqlDialect);
    await badge.waitForDisplayed({ timeout: 10_000 });
    const text = await badge.getText();
    expect(text).toMatch(/MySQL/i);
    expect(text).not.toMatch(/MariaDB/i);
    expect(text).toMatch(/8\./);
  });

  it("shows the query editor and the seeded database in the schema browser", async () => {
    await openMySQLClient("MySQL Schema");

    const queryEditor = await $(S.mysqlQueryEditor);
    expect(await queryEditor.isExisting()).toBe(true);

    const databases = await $(S.mysqlDatabases);
    await databases.waitForDisplayed({ timeout: 10_000 });
    await browser.waitUntil(
      async () => (await databases.getText()).includes("testdb"),
      {
        timeout: 10_000,
        timeoutMsg: "testdb not listed in the database browser",
      },
    );

    const testdb = await databases.$('[aria-label="Browse database testdb"]');
    await testdb.click();

    const tables = await $(S.mysqlTables);
    await tables.waitForDisplayed({ timeout: 10_000 });
    await browser.waitUntil(
      async () => (await tables.getText()).includes("people"),
      {
        timeout: 10_000,
        timeoutMsg: "people table not listed for testdb",
      },
    );
  });

  it("executes a SELECT over the seeded rows and renders the grid", async () => {
    await openMySQLClient("MySQL Query");

    await runQuery("SELECT name FROM testdb.people ORDER BY id;");

    const rows = await $$(S.mysqlResultRow);
    expect(Number(await rows.length)).toBe(5);

    const firstCell = await rows[0].$(S.mysqlResultCell);
    expect((await firstCell.getText()).trim()).toBe("Ada");
  });

  it("lists testdb via SHOW DATABASES", async () => {
    await openMySQLClient("MySQL DB List");

    await runQuery("SHOW DATABASES;");

    const results = await $(S.mysqlResults);
    expect(await results.getText()).toContain("testdb");
  });

  it("counts the seeded London rows", async () => {
    await openMySQLClient("MySQL Count");

    await runQuery(
      "SELECT COUNT(*) AS n FROM testdb.people WHERE city = 'London';",
    );
    const cell = await $(S.mysqlResultCell);
    expect((await cell.getText()).trim()).toBe("2");
  });
});
