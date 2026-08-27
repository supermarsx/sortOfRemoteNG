// t66-e6 — VoIP Phone (Yealink) session panel against the fake-phone fixture.
//
// The fixture (e2e/fixtures/voip-phone/server.mjs) is dependency-free Node,
// so it is started IN-PROCESS on 127.0.0.1:0 — no Docker required. The same
// server is also published as compose service `test-voip-phone` (8090/8091)
// for manual runs. Both firmware generations are exercised: legacy (HTTP
// Basic on /cgi-bin/ConfigManApp.com) and servlet (login form + JSESSIONID).
//
// Requires t66-e2's `voip_phone_*` command registration in the built app.
import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  closeAllSessions,
} from "../../helpers/app";
import {
  createPhoneServer,
  listen,
  type PhoneMode,
  type PhoneServer,
} from "../../fixtures/voip-phone/server.mjs";

const FIXTURE_HOST = "127.0.0.1";
const PHONE_USER = "admin";
const PHONE_PASSWORD = "admin";
const CONNECTION_NAME = "Yealink E2E";

type FixtureKey = PhoneMode | "servlet-action-uri";

const phones: Record<FixtureKey, PhoneServer | null> = {
  legacy: null,
  servlet: null,
  "servlet-action-uri": null,
};
const ports: Record<FixtureKey, number> = {
  legacy: 0,
  servlet: 0,
  "servlet-action-uri": 0,
};

async function startPhone(key: FixtureKey): Promise<void> {
  const server = createPhoneServer({
    mode: key === "legacy" ? "legacy" : "servlet",
    actionUri: key === "servlet-action-uri",
    username: PHONE_USER,
    password: PHONE_PASSWORD,
  });
  ports[key] = await listen(server, 0, FIXTURE_HOST);
  phones[key] = server;
}

async function stopPhones(): Promise<void> {
  await Promise.all(
    (Object.keys(phones) as FixtureKey[]).map((key) => {
      const server = phones[key];
      phones[key] = null;
      return server
        ? new Promise<void>((resolve) => server.close(() => resolve()))
        : Promise.resolve();
    }),
  );
}

function resetPhoneState(): void {
  for (const server of Object.values(phones)) {
    if (!server) continue;
    server.phoneState.reboots.length = 0;
    server.phoneState.loginAttempts.length = 0;
    server.phoneState.sessions.clear();
  }
}

interface CreateOptions {
  password?: string;
  actionUriEnabled?: boolean;
}

async function createVoipPhoneConnection(
  key: FixtureKey,
  options: CreateOptions = {},
): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  await (await $(S.editorName)).setValue(CONNECTION_NAME);

  // Pick the protocol FIRST: handleProtocolChange resets the port to 80.
  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText("VoIP Phone (Yealink)");
  await browser.pause(200);

  await (await $(S.editorHostname)).setValue(FIXTURE_HOST);

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(ports[key]));

  await (await $(S.editorUsername)).setValue(PHONE_USER);
  await (
    await $(S.editorPassword)
  ).setValue(options.password ?? PHONE_PASSWORD);

  if (options.actionUriEnabled) {
    // Protocol tab → Advanced subtab → "Action URI enabled on the phone".
    await (await $(S.editorTabProtocol)).click();
    const advanced = await $(S.editorProtocolSubtabAdvanced);
    await advanced.waitForDisplayed({ timeout: 5_000 });
    await advanced.click();
    const toggle = await $(S.voipPhoneActionUriToggle);
    await toggle.waitForExist({ timeout: 5_000 });
    if (!(await toggle.isSelected())) {
      await toggle.click();
    }
  }

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

async function openPanel(
  key: FixtureKey,
  options: CreateOptions = {},
): Promise<ChainablePromiseElement> {
  await createVoipPhoneConnection(key, options);

  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  await items[0].doubleClick();
  await browser.pause(500);

  const panel = await $(S.voipPhonePanel);
  await panel.waitForDisplayed({ timeout: 10_000 });
  return panel;
}

async function waitForPhase(
  panel: ChainablePromiseElement,
  phase: "connected" | "error",
): Promise<void> {
  const pill = await panel.$(S.voipPhonePhase);
  await browser.waitUntil(
    async () => (await pill.getText()).toLowerCase().includes(phase),
    {
      timeout: 30_000,
      timeoutMsg: `panel never reached phase "${phase}"`,
    },
  );
}

async function openConnectedPanel(
  key: FixtureKey,
  options: CreateOptions = {},
): Promise<ChainablePromiseElement> {
  const panel = await openPanel(key, options);
  await waitForPhase(panel, "connected");
  await (
    await panel.$(S.voipPhoneStatus)
  ).waitForDisplayed({
    timeout: 15_000,
  });
  return panel;
}

async function fieldText(
  panel: ChainablePromiseElement,
  selector: string,
): Promise<string> {
  const row = await panel.$(selector);
  await row.waitForDisplayed({ timeout: 15_000 });
  return row.getText();
}

async function waitForToast(pattern: RegExp): Promise<string> {
  let seen = "";
  await browser.waitUntil(
    async () => {
      const stack = await $(S.toastContainer);
      if (!(await stack.isExisting())) return false;
      seen = await stack.getText();
      return pattern.test(seen);
    },
    { timeout: 15_000, timeoutMsg: `toast ${pattern} never appeared` },
  );
  return seen;
}

describe("VoIP Phone (Yealink) Panel — login, status, web UI, reboot (fake-phone fixture)", () => {
  before(async () => {
    await startPhone("legacy");
    await startPhone("servlet");
    await startPhone("servlet-action-uri");
  });

  after(async () => {
    await stopPhones();
  });

  beforeEach(async () => {
    resetPhoneState();
    await resetAppState();
    await createCollection("VoIP Phone Tests");
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("should create a VoIP Phone (Yealink) connection via the picker", async () => {
    await createVoipPhoneConnection("servlet");

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain(CONNECTION_NAME);
  });

  it("servlet: logs in with the form (JSESSIONID) and renders status + accounts", async () => {
    const panel = await openConnectedPanel("servlet");

    expect(await fieldText(panel, S.voipPhoneGeneration)).toMatch(/servlet/i);
    expect(await fieldText(panel, S.voipPhoneFieldModel)).toContain(
      "SIP-T21P_E2",
    );
    expect(await fieldText(panel, S.voipPhoneFieldFirmware)).toContain(
      "52.84.0.125",
    );
    expect(await fieldText(panel, S.voipPhoneFieldMac)).toContain(
      "80:5E:C0:AA:BB:CC",
    );
    expect(await fieldText(panel, S.voipPhoneFieldIp)).toContain(
      "192.168.1.121",
    );
    expect(await fieldText(panel, S.voipPhoneFieldUptime)).toContain(
      "12 days 01:02:03",
    );

    const accounts = await panel.$(S.voipPhoneAccounts);
    await accounts.waitForDisplayed({ timeout: 15_000 });
    const rows = await accounts.$$(S.voipPhoneAccountRow);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const registered = await rows.map((row) =>
      row.$('[data-registered="true"]').isExisting(),
    );
    expect(registered).toContain(true);
    expect(registered).toContain(false);

    const attempts = phones.servlet!.phoneState.loginAttempts;
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0]).toMatchObject({
      username: PHONE_USER,
      shape: "form-plain",
      ok: true,
    });
  });

  it("legacy: logs in with HTTP Basic and renders the ConfigManApp status page", async () => {
    const panel = await openConnectedPanel("legacy");

    expect(await fieldText(panel, S.voipPhoneGeneration)).toMatch(/legacy/i);
    expect(await fieldText(panel, S.voipPhoneFieldModel)).toContain("SIP-T20P");
    expect(await fieldText(panel, S.voipPhoneFieldFirmware)).toContain(
      "9.73.0.50",
    );
    expect(await fieldText(panel, S.voipPhoneFieldMac)).toContain(
      "00:15:65:11:22:33",
    );
    expect(await fieldText(panel, S.voipPhoneFieldIp)).toContain(
      "192.168.1.120",
    );
    // Legacy never touches the servlet login form.
    expect(phones.legacy!.phoneState.loginAttempts).toEqual([]);
  });

  it("wrong password: panel enters the error phase and shows the error box", async () => {
    const panel = await openPanel("servlet", { password: "not-the-password" });
    await waitForPhase(panel, "error");

    const error = await panel.$(S.voipPhoneError);
    await error.waitForDisplayed({ timeout: 10_000 });
    expect((await error.getText()).length).toBeGreaterThan(0);
    expect(await panel.$(S.voipPhoneStatus).isExisting()).toBe(false);
    expect(phones.servlet!.phoneState.sessions.size).toBe(0);
  });

  it("Open Web UI opens a second (browser) session tab without leaking the password", async () => {
    const panel = await openConnectedPanel("servlet");

    const countBefore = await $$(S.sessionTab).length;
    expect(countBefore).toBeGreaterThanOrEqual(1);

    await (await panel.$(S.voipPhoneOpenWeb)).click();

    await browser.waitUntil(
      async () => (await $$(S.sessionTab).length) === countBefore + 1,
      { timeout: 15_000, timeoutMsg: "web UI session tab never opened" },
    );

    // The embedded browser must reach the fixture's login form (or its
    // post-login landing page) — proves the tab targets the phone, not a
    // blank page. The tab bar itself never carries the credentials.
    const tabsText = await (await $(S.sessionTabs)).getText();
    expect(tabsText).not.toContain(PHONE_PASSWORD);
  });

  it("reboot (Action URI disabled): confirm dialog gates the request, falls back to the web form", async () => {
    const panel = await openConnectedPanel("servlet");

    await (await panel.$(S.voipPhoneReboot)).click();
    const dialog = await panel.$(S.voipPhoneRebootDialog);
    await dialog.waitForDisplayed({ timeout: 5_000 });
    expect(phones.servlet!.phoneState.reboots).toEqual([]);

    // Cancel first: nothing reaches the phone.
    await (await dialog.$(S.voipPhoneRebootCancel)).click();
    await browser.pause(200);
    expect(await panel.$(S.voipPhoneRebootDialog).isExisting()).toBe(false);
    expect(phones.servlet!.phoneState.reboots).toEqual([]);

    // Confirm for real.
    await (await panel.$(S.voipPhoneReboot)).click();
    const confirm = await panel
      .$(S.voipPhoneRebootDialog)
      .$(S.voipPhoneRebootConfirm);
    await confirm.waitForDisplayed({ timeout: 5_000 });
    await confirm.click();

    await browser.waitUntil(
      () => phones.servlet!.phoneState.reboots.length === 1,
      { timeout: 15_000, timeoutMsg: "reboot never hit the fixture" },
    );
    expect(phones.servlet!.phoneState.reboots[0]).toMatchObject({
      method: "web-form",
    });

    const toast = await waitForToast(/Reboot requested via web form/i);
    expect(toast).toContain("Reboot requested via web form.");
  });

  it("reboot (Action URI enabled on the phone + connection): uses ?key=Reboot", async () => {
    const panel = await openConnectedPanel("servlet-action-uri", {
      actionUriEnabled: true,
    });

    await (await panel.$(S.voipPhoneReboot)).click();
    const confirm = await panel
      .$(S.voipPhoneRebootDialog)
      .$(S.voipPhoneRebootConfirm);
    await confirm.waitForDisplayed({ timeout: 5_000 });
    await confirm.click();

    await browser.waitUntil(
      () => phones["servlet-action-uri"]!.phoneState.reboots.length === 1,
      {
        timeout: 15_000,
        timeoutMsg: "action-URI reboot never hit the fixture",
      },
    );
    expect(phones["servlet-action-uri"]!.phoneState.reboots[0]).toMatchObject({
      method: "action-uri",
    });

    await waitForToast(/Reboot requested via Action URI/i);
  });

  it("legacy reboot falls back to the ConfigManApp form when Action URI is refused", async () => {
    const panel = await openConnectedPanel("legacy");

    await (await panel.$(S.voipPhoneReboot)).click();
    const confirm = await panel
      .$(S.voipPhoneRebootDialog)
      .$(S.voipPhoneRebootConfirm);
    await confirm.waitForDisplayed({ timeout: 5_000 });
    await confirm.click();

    await browser.waitUntil(
      () => phones.legacy!.phoneState.reboots.length === 1,
      { timeout: 15_000, timeoutMsg: "legacy reboot never hit the fixture" },
    );
    expect(phones.legacy!.phoneState.reboots[0]).toMatchObject({
      method: "web-form",
    });
    await waitForToast(/Reboot requested via web form/i);
  });

  it("Close disconnects the phone session (fixture session is dropped)", async () => {
    const panel = await openConnectedPanel("servlet");
    expect(phones.servlet!.phoneState.sessions.size).toBeGreaterThanOrEqual(1);

    await (await panel.$(S.voipPhoneClose)).click();
    await browser.waitUntil(
      async () => !(await $(S.voipPhonePanel).isExisting()),
      { timeout: 15_000, timeoutMsg: "panel never closed" },
    );
  });
});
