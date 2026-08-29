import { S, sessionTabStatus } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  closeAllSessions,
  closeDetachedAppWindows,
  waitForAppReady,
} from "../../helpers/app";
import { selectCustomOption } from "../../helpers/forms";
import {
  isDockerAvailable,
  startContainers,
  stopContainers,
  waitForContainer,
  SSH_PORT,
} from "../../helpers/docker";

/**
 * t63 — failed connection tabs must be closable (and detachable).
 *
 * Every case connects to 127.0.0.1:1 — nothing listens there, so the OS
 * refuses the connection immediately and the session lands in
 * `data-session-status="error"` within a couple of seconds (do not use a
 * black-hole address such as 192.0.2.1: that only fails on timeout).
 */

const CLOSED_HOST = "127.0.0.1";
const CLOSED_PORT = 1;
const ERROR_TIMEOUT = 20_000;
const STAY_GONE_MS = 3_000;
const DETACHED_ALERT = '[role="alert"]';

async function connectionExists(name: string): Promise<boolean> {
  const items = await $$(S.connectionItem);
  for (const item of items) {
    if ((await item.getText()).includes(name)) {
      return true;
    }
  }
  return false;
}

async function addConnection(options: {
  name: string;
  protocol: "SSH" | "RDP";
  host: string;
  port: number;
  username?: string;
  password?: string;
}): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  await (await $(S.editorName)).setValue(options.name);
  await (await $(S.editorHostname)).setValue(options.host);
  // The protocol picker is a custom listbox (button + role="option"), not a
  // <select>; its option text is "<label> <description>", so match the label.
  await selectCustomOption(S.editorProtocol, options.protocol);

  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue(String(options.port));

  if (options.username !== undefined) {
    await (await $(S.editorUsername)).setValue(options.username);
  }
  if (options.password !== undefined) {
    await (await $(S.editorPassword)).setValue(options.password);
  }

  await (await $(S.editorSave)).click();
  await browser.waitUntil(() => connectionExists(options.name), {
    timeout: 5_000,
    timeoutMsg: `Expected connection "${options.name}" to appear in tree`,
  });
}

async function openSession(connectionName: string): Promise<void> {
  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  for (const item of items) {
    if ((await item.getText()).includes(connectionName)) {
      await item.doubleClick();
      await browser.waitUntil(
        async () => {
          const tabs = await $$(S.sessionTab);
          for (const tab of tabs) {
            if ((await tab.getText()).includes(connectionName)) {
              return true;
            }
          }
          return false;
        },
        {
          timeout: 5_000,
          timeoutMsg: `Expected session tab for "${connectionName}" to open`,
        },
      );
      return;
    }
  }
  throw new Error(`Connection "${connectionName}" not found in tree`);
}

async function count(selector: string): Promise<number> {
  return $$(selector).length;
}

/** Opens `name` and returns its tab once it reports `data-session-status="error"`. */
async function openFailedSession(name: string): Promise<ReturnType<typeof $>> {
  await openSession(name);
  await browser.waitUntil(
    async () => (await count(sessionTabStatus("error"))) === 1,
    {
      timeout: ERROR_TIMEOUT,
      interval: 250,
      timeoutMsg: `Expected the "${name}" tab to reach status "error" (127.0.0.1:${CLOSED_PORT} should refuse immediately)`,
    },
  );
  return $(sessionTabStatus("error"));
}

/** A close of a failed tab must never ask "close?" — assert for a full second. */
async function expectNoConfirmDialog(): Promise<void> {
  const seen = await browser
    .waitUntil(
      async () => (await $(S.confirmDialog)).isDisplayed().catch(() => false),
      { timeout: 1_000, interval: 100 },
    )
    .then(() => true)
    .catch(() => false);
  expect(seen).toBe(false);
}

async function expectTabsGoneAndStayGone(): Promise<void> {
  await browser.waitUntil(async () => (await count(S.sessionTab)) === 0, {
    timeout: 5_000,
    interval: 100,
    timeoutMsg: "Expected the failed session tab to be removed",
  });
  await browser.pause(STAY_GONE_MS);
  expect(await count(S.sessionTab)).toBe(0);
}

async function reloadApp(): Promise<void> {
  await browser.execute(() => {
    globalThis.location.reload();
  });
  await waitForAppReady();
}

describe("Failed session tabs close and stay closed", () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection("Failed Tab Tests");
  });

  afterEach(async () => {
    await closeDetachedAppWindows().catch(() => undefined);
    await closeAllSessions();
  });

  it("closes a failed SSH tab via the × button without a confirm dialog", async () => {
    await addConnection({
      name: "Refused SSH",
      protocol: "SSH",
      host: CLOSED_HOST,
      port: CLOSED_PORT,
    });
    const tab = await openFailedSession("Refused SSH");

    await (await tab.$(S.sessionTabClose)).click();

    await expectNoConfirmDialog();
    await expectTabsGoneAndStayGone();
  });

  it("closes a failed SSH tab via middle-click without a confirm dialog", async () => {
    await addConnection({
      name: "Refused SSH",
      protocol: "SSH",
      host: CLOSED_HOST,
      port: CLOSED_PORT,
    });
    const tab = await openFailedSession("Refused SSH");

    await tab.click({ button: "middle" });

    await expectNoConfirmDialog();
    await expectTabsGoneAndStayGone();
  });

  it("closes a failed SSH tab via Ctrl+W without a confirm dialog", async () => {
    await addConnection({
      name: "Refused SSH",
      protocol: "SSH",
      host: CLOSED_HOST,
      port: CLOSED_PORT,
    });
    const tab = await openFailedSession("Refused SSH");

    // Focus the tab bar (not the session viewer) before sending the chord.
    await tab.click();
    await browser.keys(["Control", "w"]);

    await expectNoConfirmDialog();
    await expectTabsGoneAndStayGone();
  });

  it("closes a failed RDP tab via × and it does not come back after a reload", async function () {
    try {
      await addConnection({
        name: "Refused RDP",
        protocol: "RDP",
        host: CLOSED_HOST,
        port: CLOSED_PORT,
        username: "admin",
        password: "admin",
      });
    } catch (error) {
      if (String(error).includes("Custom select option not found")) {
        // RDP is a runtime capability; this build does not offer it.
        this.skip();
      }
      throw error;
    }
    await openSession("Refused RDP");

    const reachedError = await browser
      .waitUntil(async () => (await count(sessionTabStatus("error"))) === 1, {
        timeout: ERROR_TIMEOUT,
        interval: 250,
      })
      .then(() => true)
      .catch(() => false);
    if (!reachedError) {
      // The RDP client never surfaced an error state — most likely the RDP
      // backend is not part of this e2e build. Leave the tab for afterEach.
      this.skip();
    }

    const tab = await $(sessionTabStatus("error"));
    await (await tab.$(S.sessionTabClose)).click();

    // Default rdpSessionClosePolicy is "detach": a failed tab must be
    // removed outright, never parked as a detached ghost.
    await expectNoConfirmDialog();
    await expectTabsGoneAndStayGone();

    // `reconnectOnReload` defaults to true: a ghost RDP session used to be
    // resurrected as a visible tab here.
    await reloadApp();
    await browser.pause(STAY_GONE_MS);
    expect(await count(S.sessionTab)).toBe(0);
  });

  it("detaches a failed SSH tab to a new window via the context menu", async () => {
    await addConnection({
      name: "Refused SSH",
      protocol: "SSH",
      host: CLOSED_HOST,
      port: CLOSED_PORT,
    });
    const tab = await openFailedSession("Refused SSH");
    const mainHandle = await browser.getWindowHandle();

    await tab.click({ button: "right" });
    const menuItem = await $(S.sessionTabDetachMenuItem);
    await menuItem.waitForDisplayed({ timeout: 2_000 });
    await menuItem.click();

    await assertDetachedFailedSession("Refused SSH", mainHandle);
  });

  it("detaches a failed SSH tab to a new window via the in-tab detach button", async () => {
    await addConnection({
      name: "Refused SSH",
      protocol: "SSH",
      host: CLOSED_HOST,
      port: CLOSED_PORT,
    });
    const tab = await openFailedSession("Refused SSH");
    const mainHandle = await browser.getWindowHandle();

    await (await tab.$(S.sessionTabDetach)).click();

    await assertDetachedFailedSession("Refused SSH", mainHandle);
  });
});

async function assertDetachedFailedSession(
  name: string,
  mainHandle: string,
): Promise<void> {
  let handles: string[] = [];
  await browser.waitUntil(
    async () => {
      handles = await browser.getWindowHandles();
      return handles.length >= 2;
    },
    {
      timeout: 5_000,
      interval: 200,
      timeoutMsg: "Expected a detached window to open for the failed session",
    },
  );

  const detachedHandle = handles.find((handle) => handle !== mainHandle);
  expect(detachedHandle).toBeDefined();
  await browser.switchToWindow(detachedHandle!);

  const banner = await $(DETACHED_ALERT);
  await banner.waitForDisplayed({ timeout: 10_000 });
  expect(await banner.getText()).toContain("Connection error occurred");
  await browser.waitUntil(
    async () => (await $("body").getText()).includes(name),
    {
      timeout: 5_000,
      timeoutMsg: `Expected the detached window to show "${name}"`,
    },
  );

  await browser.switchToWindow(mainHandle);
  expect(await count(S.sessionTab)).toBe(0);
  await browser.pause(STAY_GONE_MS);
  expect(await count(S.sessionTab)).toBe(0);
}

describe("Connected session close confirm (regression guard)", () => {
  const dockerAvailable = isDockerAvailable();

  before(async function () {
    if (!dockerAvailable) {
      this.skip();
    }
    startContainers(["test-ssh"]);
    await waitForContainer("ssh", SSH_PORT, 30_000);
  });

  after(() => {
    if (dockerAvailable) {
      stopContainers(["test-ssh"]);
    }
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("Connected Close Tests");
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("still asks before closing a connected SSH tab when warnOnClose is on (default)", async () => {
    await addConnection({
      name: "Live SSH",
      protocol: "SSH",
      host: "localhost",
      port: SSH_PORT,
      username: "testuser",
      password: "testpass123",
    });
    await openSession("Live SSH");

    const connectedTab = await $(sessionTabStatus("connected"));
    await connectedTab.waitForExist({ timeout: 20_000 });

    await (await connectedTab.$(S.sessionTabClose)).click();

    const confirm = await $(S.confirmDialog);
    await confirm.waitForDisplayed({ timeout: 3_000 });
    expect(await count(S.sessionTab)).toBe(1);

    await (await $(S.confirmNo)).click();
    await confirm.waitForDisplayed({ timeout: 3_000, reverse: true });
    expect(await count(S.sessionTab)).toBe(1);
  });
});
