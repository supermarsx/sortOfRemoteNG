// t65-e5 — Nginx Proxy Manager panel against the real `test-npm` compose
// fixture.
//
// Developer-local only (WDIO is not run in CI). Requires Docker; the suite
// skips itself when Docker is unavailable. The admin credentials come from
// e2e/.env (see e2e/.env.example) and reach the container through
// INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD;
// scripts/ci/e2e-npm-fixture.mjs is the readiness gate and also repairs the
// factory-account / forced-password-change path on older image tags.
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
  NPM_PORT,
} from "../../helpers/docker";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const FIXTURE_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "ci",
  "e2e-npm-fixture.mjs",
);

const NPM_URL = process.env.NPM_URL ?? `http://127.0.0.1:${NPM_PORT}`;
const NPM_ADMIN_EMAIL = process.env.NPM_ADMIN_EMAIL ?? "admin@example.com";
const NPM_ADMIN_PASSWORD = process.env.NPM_ADMIN_PASSWORD ?? "npm-e2e-pass1234";

function runFixture(
  command: "prepare" | "wait" | "seed" | "verify-login-form",
): string {
  return execSync(`node "${FIXTURE_SCRIPT}" ${command}`, {
    encoding: "utf8",
    env: {
      ...process.env,
      NPM_URL,
      NPM_ADMIN_EMAIL,
      NPM_ADMIN_PASSWORD,
    },
  });
}

async function createNpmConnection(): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue("NPM E2E");

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText("Nginx Proxy Manager");

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function openNpmPanel(): Promise<void> {
  await createNpmConnection();

  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  await items[0].doubleClick();
  await browser.pause(1000);

  const panel = await $(S.npmPanel);
  await panel.waitForDisplayed({ timeout: 10_000 });
}

async function fillPasswordFormAndConnect(): Promise<void> {
  const form = await $(S.npmConnectionForm);
  await form.waitForDisplayed({ timeout: 10_000 });

  const apiUrl = await $(S.npmApiUrl);
  await apiUrl.clearValue();
  await apiUrl.setValue(NPM_URL);

  const passwordMode = await $(S.npmAuthModePassword);
  if (await passwordMode.isExisting()) {
    await passwordMode.click();
  }

  const email = await $(S.npmEmail);
  await email.clearValue();
  await email.setValue(NPM_ADMIN_EMAIL);

  const password = await $(S.npmPassword);
  await password.setValue(NPM_ADMIN_PASSWORD);

  const connectBtn = await $(S.npmConnectBtn);
  await connectBtn.click();

  const status = await $(S.npmStatus);
  await status.waitForDisplayed({ timeout: 30_000 });
}

describe("Nginx Proxy Manager Panel — Connection (docker fixture)", () => {
  before(function () {
    if (!isDockerAvailable()) {
      console.warn("[npm-panel.spec] Docker not available — skipping suite");
      this.skip();
      return;
    }
    runFixture("prepare");
    startContainers(["test-npm"]);
  });

  before(async () => {
    await waitForContainer("test-npm", NPM_PORT, 180_000);
    runFixture("wait");
    // Guarantee the Proxy Hosts tab has at least one row to render.
    runFixture("seed");
  });

  after(() => {
    if (isDockerAvailable()) {
      stopContainers(["test-npm"]);
    }
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("NPM Tests");
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("should create a Nginx Proxy Manager connection via the picker", async () => {
    await createNpmConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain("NPM E2E");
  });

  it("should show the connect form with both auth modes", async () => {
    await openNpmPanel();

    const apiUrl = await $(S.npmApiUrl);
    const passwordMode = await $(S.npmAuthModePassword);
    const tokenMode = await $(S.npmAuthModeToken);
    const email = await $(S.npmEmail);
    const password = await $(S.npmPassword);
    const tlsSkip = await $(S.npmTlsSkip);
    const connectBtn = await $(S.npmConnectBtn);

    expect(await apiUrl.isExisting()).toBe(true);
    expect(await passwordMode.isExisting()).toBe(true);
    expect(await tokenMode.isExisting()).toBe(true);
    expect(await email.isExisting()).toBe(true);
    expect(await password.isExisting()).toBe(true);
    expect(await tlsSkip.isExisting()).toBe(true);
    expect(await connectBtn.isExisting()).toBe(true);
  });

  it("should swap the password field for the bearer-token field in token mode", async () => {
    await openNpmPanel();

    const tokenMode = await $(S.npmAuthModeToken);
    await tokenMode.click();
    await browser.pause(200);

    const token = await $(S.npmToken);
    expect(await token.isExisting()).toBe(true);

    const password = await $(S.npmPassword);
    expect(await password.isExisting()).toBe(false);
  });

  it("should log in with the admin password and show the server version", async () => {
    await openNpmPanel();
    await fillPasswordFormAndConnect();

    const status = await $(S.npmStatus);
    const text = await status.getText();
    // `GET /api/` reports a "major.minor.revision" version.
    expect(text).toMatch(/\d+\.\d+\.\d+/);
    expect(text).toContain(NPM_ADMIN_EMAIL);

    const disconnectBtn = await $(S.npmDisconnectBtn);
    expect(await disconnectBtn.isExisting()).toBe(true);

    const openWebUi = await $(S.npmOpenWebUi);
    expect(await openWebUi.isExisting()).toBe(true);
  });

  it("should list the seeded proxy host on the Proxy Hosts tab", async () => {
    await openNpmPanel();
    await fillPasswordFormAndConnect();

    const proxyHostsTab = await $(S.npmProxyHostsTab);
    await proxyHostsTab.click();

    const firstRow = await $(S.npmProxyHostRow);
    await firstRow.waitForExist({ timeout: 30_000 });

    const rows = await $$(S.npmProxyHostRow);
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const toggle = await $(S.npmProxyHostToggle);
    expect(await toggle.isExisting()).toBe(true);
  });

  it("should expose the Redirections / Streams / Certificates tabs after connecting", async () => {
    await openNpmPanel();
    await fillPasswordFormAndConnect();

    const redirectionsTab = await $(S.npmRedirectionsTab);
    const streamsTab = await $(S.npmStreamsTab);
    const certificatesTab = await $(S.npmCertificatesTab);

    expect(await redirectionsTab.isExisting()).toBe(true);
    expect(await streamsTab.isExisting()).toBe(true);
    expect(await certificatesTab.isExisting()).toBe(true);
  });

  it("should refresh the login token from the status bar", async () => {
    await openNpmPanel();
    await fillPasswordFormAndConnect();

    const refreshTokenBtn = await $(S.npmRefreshTokenBtn);
    expect(await refreshTokenBtn.isExisting()).toBe(true);
    await refreshTokenBtn.click();
    await browser.pause(1000);

    // A failed refresh surfaces in the panel's error region.
    const error = await $(S.npmError);
    expect(await error.isExisting()).toBe(false);

    const status = await $(S.npmStatus);
    expect(await status.getText()).toMatch(/\d+\.\d+\.\d+/);
  });

  it("should disconnect and return to the connect form", async () => {
    await openNpmPanel();
    await fillPasswordFormAndConnect();

    const disconnectBtn = await $(S.npmDisconnectBtn);
    await disconnectBtn.click();

    const form = await $(S.npmConnectionForm);
    await form.waitForDisplayed({ timeout: 10_000 });
    expect(await form.isDisplayed()).toBe(true);
  });

  // The panel's "Open web UI (auto-login)" types into NPM's *own* login form,
  // so its selectors must match whatever the running image ships. This asserts
  // that against the live container instead of trusting the constant: NPM
  // 2.13+ renamed the fields from identity/secret to email/password.
  it("should ship a login form matching NPM_AUTO_LOGIN_SELECTORS", () => {
    const output = runFixture("verify-login-form");
    expect(output).toContain('input[name="email"]');
    expect(output).toContain('input[name="password"]');
    expect(output).toContain('button[type="submit"]');
  });
});
