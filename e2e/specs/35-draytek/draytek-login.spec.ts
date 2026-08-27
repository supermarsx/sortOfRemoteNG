// t68-e4 — DrayTek Vigor panel against the fake-router fixture.
//
// The fixture (e2e/fixtures/draytek/server.mjs) is dependency-free Node, so
// it is started IN-PROCESS on 127.0.0.1:0 — no Docker required. The same
// server is also published as compose service `test-draytek` (8092/8093) for
// manual runs. Both DrayOS login generations are exercised: classic
// (aa/ab base64 only) and the >= 4.4 `sFormAuthStr` token variant.
//
// Requires t68-e2's `draytek_*` command registration in the built app.
import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  closeAllSessions,
} from "../../helpers/app";
import {
  createDraytekServer,
  listen,
  type DraytekLoginScheme,
  type DraytekServer,
} from "../../fixtures/draytek/server.mjs";

const FIXTURE_HOST = "127.0.0.1";
const ROUTER_USER = "admin";
const ROUTER_PASSWORD = "vigor-e2e-pass";
const MODEL = "Vigor2865ax";
const FIRMWARE = "4.4.5.1";
const ROUTER_NAME = "vigor-e2e";

const routers: Record<DraytekLoginScheme, DraytekServer | null> = {
  classic: null,
  token: null,
  rsa: null,
};
const ports: Record<DraytekLoginScheme, number> = {
  classic: 0,
  token: 0,
  rsa: 0,
};

async function startRouter(scheme: DraytekLoginScheme): Promise<void> {
  const server = createDraytekServer({
    scheme,
    username: ROUTER_USER,
    password: ROUTER_PASSWORD,
    model: MODEL,
    firmware: FIRMWARE,
    routerName: ROUTER_NAME,
  });
  ports[scheme] = await listen(server, 0, FIXTURE_HOST);
  routers[scheme] = server;
}

async function stopRouters(): Promise<void> {
  await Promise.all(
    (Object.keys(routers) as DraytekLoginScheme[]).map((scheme) => {
      const server = routers[scheme];
      routers[scheme] = null;
      return server
        ? new Promise<void>((resolve) => server.close(() => resolve()))
        : Promise.resolve();
    }),
  );
}

function resetRouterState(): void {
  for (const server of Object.values(routers)) {
    if (!server) continue;
    server.routerState.reboots.length = 0;
    server.routerState.loginAttempts.length = 0;
    server.routerState.sessions.clear();
    server.routerState.tokens.clear();
  }
}

/** The panel root (`data-testid="draytek-panel"`). */
async function draytekPanel(): Promise<ChainablePromiseElement> {
  const panel = await $(S.draytekPanel);
  await panel.waitForDisplayed({ timeout: 10_000 });
  return panel;
}

async function createDraytekConnection(): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue("DrayTek E2E");

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText("DrayTek Vigor");

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function openDraytekPanel(): Promise<ChainablePromiseElement> {
  await createDraytekConnection();

  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  await items[0].doubleClick();
  await browser.pause(1000);

  return draytekPanel();
}

async function fillFormAndConnect(
  scheme: DraytekLoginScheme,
  password: string = ROUTER_PASSWORD,
): Promise<ChainablePromiseElement> {
  const panel = await draytekPanel();

  const host = await panel.$(S.draytekHost);
  await host.waitForDisplayed({ timeout: 10_000 });
  await host.clearValue();
  await host.setValue(FIXTURE_HOST);

  const port = await panel.$(S.draytekPort);
  await port.clearValue();
  await port.setValue(String(ports[scheme]));

  const username = await panel.$(S.draytekUsername);
  await username.clearValue();
  await username.setValue(ROUTER_USER);

  const pass = await panel.$(S.draytekPassword);
  await pass.clearValue();
  await pass.setValue(password);

  // The fixture is plain HTTP: untick "Use TLS".
  const tls = await panel.$(S.draytekUseTls);
  if (await tls.isSelected()) {
    await tls.click();
  }

  const connectBtn = await panel.$(S.draytekConnectBtn);
  await connectBtn.click();
  return panel;
}

async function connectAndWaitForTabs(
  scheme: DraytekLoginScheme,
): Promise<ChainablePromiseElement> {
  const panel = await fillFormAndConnect(scheme);
  const statusTab = await panel.$(S.draytekTabStatus);
  await statusTab.waitForDisplayed({ timeout: 30_000 });
  return panel;
}

describe("DrayTek Vigor Panel — login, status, reboot (fake-router fixture)", () => {
  before(async () => {
    await startRouter("classic");
    await startRouter("token");
  });

  after(async () => {
    await stopRouters();
  });

  beforeEach(async () => {
    resetRouterState();
    await resetAppState();
    await createCollection("DrayTek Tests");
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("should create a DrayTek Vigor connection via the picker", async () => {
    await createDraytekConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain("DrayTek E2E");
  });

  it("should show the connect form with host/port/username/password/TLS fields", async () => {
    const panel = await openDraytekPanel();

    expect(await panel.$(S.draytekHost).isExisting()).toBe(true);
    expect(await panel.$(S.draytekPort).isExisting()).toBe(true);
    expect(await panel.$(S.draytekUsername).isExisting()).toBe(true);
    expect(await panel.$(S.draytekPassword).isExisting()).toBe(true);
    expect(await panel.$(S.draytekUseTls).isExisting()).toBe(true);
    expect(await panel.$(S.draytekConnectBtn).isExisting()).toBe(true);
  });

  it("classic login: header shows the fixture's hostname/model/firmware and a Disconnect button", async () => {
    await openDraytekPanel();
    const panel = await connectAndWaitForTabs("classic");

    const title = await panel.$(S.draytekPanelTitle);
    const text = await title.getText();
    expect(text).toContain(ROUTER_NAME);
    expect(text).toContain(MODEL);
    expect(text).toContain(FIRMWARE);

    expect(await panel.$(S.draytekDisconnectBtn).isExisting()).toBe(true);

    const attempts = routers.classic!.routerState.loginAttempts;
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0]).toMatchObject({
      username: ROUTER_USER,
      method: "post",
      tokenPresent: false,
      ok: true,
    });
  });

  it("classic login: Status tab renders model, firmware, build, uptime and the WAN table", async () => {
    await openDraytekPanel();
    const panel = await connectAndWaitForTabs("classic");

    const statusTitle = await panel.$(S.draytekStatusTitle);
    await statusTitle.waitForDisplayed({ timeout: 15_000 });

    await browser.waitUntil(
      async () => (await panel.getText()).includes("203.0.113.5"),
      { timeout: 15_000, timeoutMsg: "WAN1 IP never appeared" },
    );
    const text = await panel.getText();
    expect(text).toContain(MODEL);
    expect(text).toContain(FIRMWARE);
    expect(text).toContain("Feb 17 2022 12:21:04");
    expect(text).toContain("3d 04:12:55");
    expect(text).toContain("WAN1");
    expect(text).toContain("203.0.113.1");
    expect(text).toContain("WAN2");
  });

  it("sFormAuthStr login (fw >= 4.4): token is scraped and echoed, session established", async () => {
    await openDraytekPanel();
    const panel = await connectAndWaitForTabs("token");

    const title = await panel.$(S.draytekPanelTitle);
    expect(await title.getText()).toContain(MODEL);

    const attempts = routers.token!.routerState.loginAttempts;
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0]).toMatchObject({
      username: ROUTER_USER,
      method: "post",
      tokenPresent: true,
      tokenAccepted: true,
      ok: true,
    });
  });

  it("wrong password: stays on the connect form and surfaces an error", async () => {
    await openDraytekPanel();
    const panel = await fillFormAndConnect("classic", "not-the-password");

    await browser.waitUntil(
      async () =>
        /login rejected|check username\/password/i.test(await panel.getText()),
      { timeout: 30_000, timeoutMsg: "auth error never surfaced" },
    );
    expect(await panel.$(S.draytekConnectBtn).isExisting()).toBe(true);
    expect(await panel.$(S.draytekTabStatus).isExisting()).toBe(false);
    expect(routers.classic!.routerState.sessions.size).toBe(0);
  });

  it("reboot: requires the confirm dialog, then the fixture receives sReboot=Current", async () => {
    await openDraytekPanel();
    const panel = await connectAndWaitForTabs("classic");

    const actionsTab = await panel.$(S.draytekTabActions);
    await actionsTab.click();

    const rebootBtn = await panel.$(S.draytekRebootBtn);
    await rebootBtn.waitForDisplayed({ timeout: 10_000 });
    await rebootBtn.click();

    // Nothing reaches the device until the admin confirms.
    const dialog = await panel.$(S.draytekRebootConfirm);
    await dialog.waitForDisplayed({ timeout: 5_000 });
    expect(await dialog.getText()).toContain(FIXTURE_HOST);
    expect(routers.classic!.routerState.reboots).toEqual([]);

    // Cancel first: still nothing.
    const cancel = await dialog.$(S.draytekRebootCancel);
    await cancel.click();
    await browser.pause(200);
    expect(await panel.$(S.draytekRebootConfirm).isExisting()).toBe(false);
    expect(routers.classic!.routerState.reboots).toEqual([]);

    // Confirm for real.
    await (await panel.$(S.draytekRebootBtn)).click();
    const yes = await panel.$(S.draytekRebootConfirm).$(S.draytekRebootYes);
    await yes.waitForDisplayed({ timeout: 5_000 });
    await yes.click();

    await browser.waitUntil(
      () => routers.classic!.routerState.reboots.length === 1,
      { timeout: 15_000, timeoutMsg: "reboot.cgi never hit the fixture" },
    );
    expect(routers.classic!.routerState.reboots[0]).toMatchObject({
      method: "post",
      mode: "Current",
    });

    await browser.waitUntil(
      async () => (await panel.getText()).includes("Reboot accepted"),
      { timeout: 15_000, timeoutMsg: "reboot result never rendered" },
    );
  });

  it("reboot on sFormAuthStr firmware echoes the token", async () => {
    await openDraytekPanel();
    const panel = await connectAndWaitForTabs("token");

    await (await panel.$(S.draytekTabActions)).click();
    const rebootBtn = await panel.$(S.draytekRebootBtn);
    await rebootBtn.waitForDisplayed({ timeout: 10_000 });
    await rebootBtn.click();
    const yes = await panel.$(S.draytekRebootConfirm).$(S.draytekRebootYes);
    await yes.waitForDisplayed({ timeout: 5_000 });
    await yes.click();

    await browser.waitUntil(
      () => routers.token!.routerState.reboots.length === 1,
      { timeout: 15_000, timeoutMsg: "reboot.cgi never hit the token fixture" },
    );
    expect(routers.token!.routerState.reboots[0]).toMatchObject({
      mode: "Current",
      tokenPresent: true,
    });
  });

  it("Actions tab offers Open Web UI pointing at the fixture's admin URL", async () => {
    await openDraytekPanel();
    const panel = await connectAndWaitForTabs("classic");

    await (await panel.$(S.draytekTabActions)).click();
    const openWebUi = await panel.$(S.draytekOpenWebUi);
    await openWebUi.waitForDisplayed({ timeout: 10_000 });
    expect(await openWebUi.isExisting()).toBe(true);

    // The tab prints the URL it will open; it must target the fixture over
    // plain HTTP. Clicking is deliberately NOT done — it launches the OS
    // browser (open_url_external) outside the WebDriver session.
    const text = await panel.getText();
    expect(text).toContain(`http://${FIXTURE_HOST}:${ports.classic}`);
  });

  it("should disconnect and return to the connect form", async () => {
    await openDraytekPanel();
    const panel = await connectAndWaitForTabs("classic");

    await (await panel.$(S.draytekDisconnectBtn)).click();

    const host = await panel.$(S.draytekHost);
    await host.waitForDisplayed({ timeout: 10_000 });
    expect(await panel.$(S.draytekConnectBtn).isExisting()).toBe(true);
  });
});
