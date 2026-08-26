// t64-e5 — Portainer panel against the real `test-portainer` compose fixture.
//
// Developer-local only (WDIO is not run in CI). Requires Docker; the suite
// skips itself when Docker is unavailable. The admin credentials come from
// e2e/.env (see e2e/.env.example) and are written into the container via
// scripts/ci/e2e-portainer-fixture.mjs before compose starts.
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
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
  waitForContainer,
  PORTAINER_PORT,
} from "../../helpers/docker";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const FIXTURE_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "ci",
  "e2e-portainer-fixture.mjs",
);

const PORTAINER_URL =
  process.env.PORTAINER_URL ?? `http://127.0.0.1:${PORTAINER_PORT}`;
const PORTAINER_USER = process.env.PORTAINER_USER ?? "admin";
const PORTAINER_ADMIN_PASSWORD =
  process.env.PORTAINER_ADMIN_PASSWORD ?? "portainer-e2e-pass1234";

function runFixture(command: "prepare" | "wait"): void {
  execSync(`node "${FIXTURE_SCRIPT}" ${command}`, {
    stdio: "inherit",
    env: {
      ...process.env,
      PORTAINER_URL,
      PORTAINER_USER,
      PORTAINER_ADMIN_PASSWORD,
    },
  });
}

async function createPortainerConnection(): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue("Portainer E2E");

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText("Portainer");

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function openPortainerPanel(): Promise<void> {
  await createPortainerConnection();

  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  await items[0].doubleClick();
  await browser.pause(1000);

  const panel = await $(S.portainerPanel);
  await panel.waitForDisplayed({ timeout: 10_000 });
}

async function fillPasswordFormAndConnect(): Promise<void> {
  const form = await $(S.portainerConnectionForm);
  await form.waitForDisplayed({ timeout: 10_000 });

  const baseUrl = await $(S.portainerBaseUrl);
  await baseUrl.clearValue();
  await baseUrl.setValue(PORTAINER_URL);

  const passwordMode = await $(S.portainerAuthModePassword);
  if (await passwordMode.isExisting()) {
    await passwordMode.click();
  }

  const username = await $(S.portainerUsername);
  await username.clearValue();
  await username.setValue(PORTAINER_USER);

  const password = await $(S.portainerPassword);
  await password.setValue(PORTAINER_ADMIN_PASSWORD);

  const connectBtn = await $(S.portainerConnectBtn);
  await connectBtn.click();

  const status = await $(S.portainerStatus);
  await status.waitForDisplayed({ timeout: 30_000 });
}

describe("Portainer Panel — Connection (docker fixture)", () => {
  before(function () {
    if (!isDockerAvailable()) {
      console.warn(
        "[portainer-panel.spec] Docker not available — skipping suite",
      );
      this.skip();
      return;
    }
    runFixture("prepare");
    startContainers(["test-portainer"]);
  });

  before(async () => {
    await waitForContainer("portainer", PORTAINER_PORT, 60_000);
    runFixture("wait");
  });

  after(() => {
    if (isDockerAvailable()) {
      stopContainers(["test-portainer"]);
    }
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("Portainer Tests");
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("should create a Portainer connection via the picker", async () => {
    await createPortainerConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain("Portainer E2E");
  });

  it("should show the connect form with auth-mode fields", async () => {
    await openPortainerPanel();

    const baseUrl = await $(S.portainerBaseUrl);
    const passwordMode = await $(S.portainerAuthModePassword);
    const apiKeyMode = await $(S.portainerAuthModeApiKey);
    const username = await $(S.portainerUsername);
    const password = await $(S.portainerPassword);
    const tlsSkip = await $(S.portainerTlsSkip);
    const connectBtn = await $(S.portainerConnectBtn);

    expect(await baseUrl.isExisting()).toBe(true);
    expect(await passwordMode.isExisting()).toBe(true);
    expect(await apiKeyMode.isExisting()).toBe(true);
    expect(await username.isExisting()).toBe(true);
    expect(await password.isExisting()).toBe(true);
    expect(await tlsSkip.isExisting()).toBe(true);
    expect(await connectBtn.isExisting()).toBe(true);
  });

  it("should hide the password field and show the API-key field in API-key mode", async () => {
    await openPortainerPanel();

    const apiKeyMode = await $(S.portainerAuthModeApiKey);
    await apiKeyMode.click();
    await browser.pause(200);

    const apiKey = await $(S.portainerApiKey);
    expect(await apiKey.isExisting()).toBe(true);

    const password = await $(S.portainerPassword);
    expect(await password.isExisting()).toBe(false);
  });

  it("should log in with admin password and show the server version", async () => {
    await openPortainerPanel();
    await fillPasswordFormAndConnect();

    const status = await $(S.portainerStatus);
    const text = await status.getText();
    expect(text).toMatch(/\d+\.\d+/);

    const disconnectBtn = await $(S.portainerDisconnectBtn);
    expect(await disconnectBtn.isExisting()).toBe(true);

    const openWebUi = await $(S.portainerOpenWebUi);
    expect(await openWebUi.isExisting()).toBe(true);
  });

  it("should list at least one container on the Containers tab", async () => {
    await openPortainerPanel();
    await fillPasswordFormAndConnect();

    const containersTab = await $(S.portainerContainersTab);
    await containersTab.click();

    // The Portainer container itself is always visible through the
    // docker.sock-backed "local" environment.
    const firstRow = await $(S.portainerContainerRow);
    await firstRow.waitForExist({ timeout: 30_000 });

    const rows = await $$(S.portainerContainerRow);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("should expose Environments / Containers / Stacks tabs after connecting", async () => {
    await openPortainerPanel();
    await fillPasswordFormAndConnect();

    const endpointsTab = await $(S.portainerEndpointsTab);
    const containersTab = await $(S.portainerContainersTab);
    const stacksTab = await $(S.portainerStacksTab);

    expect(await endpointsTab.isExisting()).toBe(true);
    expect(await containersTab.isExisting()).toBe(true);
    expect(await stacksTab.isExisting()).toBe(true);
  });

  it("should disconnect and return to the connect form", async () => {
    await openPortainerPanel();
    await fillPasswordFormAndConnect();

    const disconnectBtn = await $(S.portainerDisconnectBtn);
    await disconnectBtn.click();

    const form = await $(S.portainerConnectionForm);
    await form.waitForDisplayed({ timeout: 10_000 });
    expect(await form.isDisplayed()).toBe(true);
  });
});
