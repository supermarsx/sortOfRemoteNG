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
  MARIADB_PORT,
  waitForContainer,
} from "../../helpers/docker";
import { selectCustomOption } from "../../helpers/forms";
import { openConnectionItem, waitForConnectionItem } from "../../helpers/ssh";

// Tier: opt-in (Docker). Fixture: compose service `test-mariadb` (mariadb:11,
// host port 13307), seeded by the SAME e2e/fixtures/db/mysql/01-seed.sql as
// test-mysql. MariaDB is not a separate protocol id: it is the "MySQL /
// MariaDB" engine with the dialect auto-detected after connect (plan t69
// D1.3), so this spec proves parity plus the MariaDB badge. The MARIADB_*
// container env mirrors MYSQL_USER / MYSQL_PASSWORD.
const MYSQL_USER = process.env.MYSQL_USER ?? "testuser";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD ?? "testpass";
const SERVICE = "test-mariadb";

async function createMariaDBConnection(name: string): Promise<void> {
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
  await portInput.setValue(String(MARIADB_PORT));

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue(MYSQL_USER);

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue(MYSQL_PASSWORD);

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await waitForConnectionItem(name);
}

async function openMariaDBClient(name: string): Promise<void> {
  await createMariaDBConnection(name);
  await openConnectionItem(name);

  const client = await $(S.mysqlClient);
  await client.waitForDisplayed({ timeout: 20_000 });

  const status = await $(S.mysqlStatus);
  await browser.waitUntil(
    async () => /connected|ready/i.test(await status.getText().catch(() => "")),
    {
      timeout: 20_000,
      timeoutMsg: "MariaDB session did not reach connected state",
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

describe("MariaDB Client", function () {
  before(async function () {
    if (!isDockerAvailable()) {
      this.skip();
    }
    startContainers([SERVICE]);
    await waitForContainer(SERVICE, MARIADB_PORT, 120_000);
  });

  after(async () => {
    if (isDockerAvailable()) {
      stopContainers([SERVICE]);
    }
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("MariaDB Test");
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("connects on the MariaDB port and shows the client", async () => {
    await openMariaDBClient("Test MariaDB");

    const client = await $(S.mysqlClient);
    expect(await client.isDisplayed()).toBe(true);

    const tabs = await $$(S.sessionTab);
    expect(Number(await tabs.length)).toBeGreaterThan(0);
  });

  it("reports the detected dialect as MariaDB", async () => {
    await openMariaDBClient("MariaDB Dialect");

    const badge = await $(S.mysqlDialect);
    await badge.waitForDisplayed({ timeout: 10_000 });
    const text = await badge.getText();
    expect(text).toMatch(/MariaDB/i);
    expect(text).toMatch(/11\./);
  });

  it("browses testdb > people in the schema tree", async () => {
    await openMariaDBClient("MariaDB Schema");

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
    await openMariaDBClient("MariaDB Query");

    await runQuery("SELECT name FROM testdb.people ORDER BY id;");

    const rows = await $$(S.mysqlResultRow);
    expect(Number(await rows.length)).toBe(5);

    const firstCell = await rows[0].$(S.mysqlResultCell);
    expect((await firstCell.getText()).trim()).toBe("Ada");
  });

  it("lists testdb via SHOW DATABASES", async () => {
    await openMariaDBClient("MariaDB DB List");

    await runQuery("SHOW DATABASES;");

    const results = await $(S.mysqlResults);
    expect(await results.getText()).toContain("testdb");
  });

  it("reads the seeded view (parity with MySQL)", async () => {
    await openMariaDBClient("MariaDB View");

    await runQuery("SELECT name FROM testdb.people_in_london ORDER BY id;");

    const rows = await $$(S.mysqlResultRow);
    expect(Number(await rows.length)).toBe(2);
  });
});
