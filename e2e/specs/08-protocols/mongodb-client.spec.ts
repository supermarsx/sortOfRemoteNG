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
  MONGO_PORT,
  waitForContainer,
} from "../../helpers/docker";
import { selectCustomOption } from "../../helpers/forms";
import { openConnectionItem, waitForConnectionItem } from "../../helpers/ssh";

// Tier: opt-in (Docker). Fixture: compose service `test-mongo` (mongo:7, host
// port 27117), seeded by e2e/fixtures/db/mongo/01-seed.js: testdb.people
// (5 docs, 2 in London, nested `address`, index `city_1`) and `testuser`
// authenticating against `admin`. The connection editor's MongoDB auth-database
// field is left at its default (`admin`), so only host/port/user/password are set.
const MONGO_USER = process.env.MONGO_USER ?? "testuser";
const MONGO_PASSWORD = process.env.MONGO_PASSWORD ?? "testpass";
const SERVICE = "test-mongo";

async function createMongoConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue("127.0.0.1");

  await selectCustomOption(S.editorProtocol, ["MongoDB"]);

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(MONGO_PORT));

  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue(MONGO_USER);

  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue(MONGO_PASSWORD);

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await waitForConnectionItem(name);
}

async function openMongoClient(name: string): Promise<void> {
  await createMongoConnection(name);
  await openConnectionItem(name);

  const client = await $(S.mongodbClient);
  await client.waitForDisplayed({ timeout: 20_000 });

  const status = await $(S.mongodbStatus);
  await browser.waitUntil(
    async () => /connected|ready/i.test(await status.getText().catch(() => "")),
    {
      timeout: 20_000,
      timeoutMsg: "MongoDB session did not reach connected state",
    },
  );
}

async function browseToPeople(): Promise<void> {
  const databases = await $(S.mongodbDatabases);
  await databases.waitForDisplayed({ timeout: 10_000 });
  await browser.waitUntil(
    async () => (await databases.getText()).includes("testdb"),
    {
      timeout: 10_000,
      timeoutMsg: "testdb not listed in the database browser",
    },
  );
  const testdb = await databases.$(
    '[data-testid="mongodb-database"][data-name="testdb"]',
  );
  await testdb.click();

  const collections = await $(S.mongodbCollections);
  await collections.waitForDisplayed({ timeout: 10_000 });
  await browser.waitUntil(
    async () => (await collections.getText()).includes("people"),
    {
      timeout: 10_000,
      timeoutMsg: "people collection not listed for testdb",
    },
  );
  const people = await collections.$(
    '[data-testid="mongodb-collection"][data-name="people"]',
  );
  await people.click();
}

async function setTextValue(selector: string, value: string): Promise<void> {
  const input = await $(selector);
  await input.click();
  await input.clearValue();
  await input.setValue(value);
}

async function runFind(
  filter: string,
  limit: number,
  skip: number,
): Promise<void> {
  await setTextValue(S.mongodbFilter, filter);
  await setTextValue(S.mongodbLimit, String(limit));
  await setTextValue(S.mongodbSkip, String(skip));

  const findBtn = await $(S.mongodbFind);
  await findBtn.click();

  const results = await $(S.mongodbResults);
  await results.waitForDisplayed({ timeout: 15_000 });
  await browser.waitUntil(
    async () => Number(await (await $$(S.mongodbResultRow)).length) > 0,
    {
      timeout: 15_000,
      timeoutMsg: `No result rows for filter ${filter}`,
    },
  );
}

describe("MongoDB Client", function () {
  before(async function () {
    if (!isDockerAvailable()) {
      this.skip();
    }
    startContainers([SERVICE]);
    await waitForContainer(SERVICE, MONGO_PORT, 120_000);
  });

  after(async () => {
    if (isDockerAvailable()) {
      stopContainers([SERVICE]);
    }
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("MongoDB Test");
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("connects and browses testdb > people", async () => {
    await openMongoClient("Test MongoDB");
    await browseToPeople();

    const tabs = await $$(S.sessionTab);
    expect(Number(await tabs.length)).toBeGreaterThan(0);
  });

  it("finds documents by filter with a limit", async () => {
    await openMongoClient("Mongo Find");
    await browseToPeople();

    await runFind('{"city":"London"}', 10, 0);

    const rows = await $$(S.mongodbResultRow);
    expect(Number(await rows.length)).toBe(2);

    const results = await $(S.mongodbResults);
    const text = await results.getText();
    expect(text).toContain("Ada");
    expect(text).toContain("Margaret");
  });

  it("toggles to JSON view and exposes extended-JSON _id", async () => {
    await openMongoClient("Mongo JSON");
    await browseToPeople();

    await runFind('{"name":"Ada"}', 10, 0);

    const toggle = await $(S.mongodbJsonToggle);
    await toggle.click();

    const results = await $(S.mongodbResults);
    await browser.waitUntil(
      async () => (await results.getText()).includes("$oid"),
      {
        timeout: 10_000,
        timeoutMsg: 'JSON view did not render the _id as {"$oid": ...}',
      },
    );
    expect(await results.getText()).toContain("address");
  });

  it("honours skip for pagination", async () => {
    await openMongoClient("Mongo Skip");
    await browseToPeople();

    await runFind("{}", 1, 0);
    let firstRow = await $(S.mongodbResultRow);
    const firstBefore = await firstRow.getText();

    await runFind("{}", 1, 1);
    firstRow = await $(S.mongodbResultRow);
    const firstAfter = await firstRow.getText();

    expect(firstAfter).not.toBe(firstBefore);
  });

  it("runs an aggregation pipeline", async () => {
    await openMongoClient("Mongo Aggregate");
    await browseToPeople();

    await setTextValue(
      S.mongodbAggregateEditor,
      '[{"$group":{"_id":"$city","n":{"$sum":1}}},{"$sort":{"_id":1}}]',
    );
    const run = await $(S.mongodbAggregateRun);
    await run.click();

    const results = await $(S.mongodbResults);
    await results.waitForDisplayed({ timeout: 15_000 });
    await browser.waitUntil(
      async () => Number(await (await $$(S.mongodbResultRow)).length) >= 4,
      {
        timeout: 15_000,
        timeoutMsg: "aggregate did not return one row per city",
      },
    );
    expect(await results.getText()).toContain("London");
  });

  it("lists the seeded index in the indexes tab", async () => {
    await openMongoClient("Mongo Indexes");
    await browseToPeople();

    const indexes = await $(S.mongodbIndexes);
    await indexes.waitForDisplayed({ timeout: 10_000 });
    await indexes.click();
    await browser.waitUntil(
      async () => (await indexes.getText()).includes("city_1"),
      {
        timeout: 10_000,
        timeoutMsg: "city_1 index not listed",
      },
    );
  });
});
