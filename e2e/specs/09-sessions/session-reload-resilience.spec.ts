import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  closeAllSessions,
  waitForAppReady,
} from "../../helpers/app";
import {
  startContainers,
  stopContainers,
  SSH_PORT,
  waitForContainer,
} from "../../helpers/docker";
import { selectCustomOption } from "../../helpers/forms";
import {
  getSshTerminalText,
  openConnectionItem,
  waitForConnectionItem,
  waitForSessionTab,
  waitForSshConnected,
  waitForSshTerminalText,
} from "../../helpers/ssh";

/**
 * CI-ONLY (never run locally: the local app uses the real user profile and
 * keychain). A webview reload must not kill a live SSH session: the tab comes
 * back, the same backend session is adopted (no "Reconnecting"), and the
 * earlier terminal output is replayed from the backend buffer.
 */

const MARKER = "resilience-marker-7f3a";

async function createSshConnection(name: string): Promise<void> {
  await (await $(S.toolbarNewConnection)).click();
  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });
  await (await $(S.editorName)).setValue(name);
  await (await $(S.editorHostname)).setValue("localhost");
  await selectCustomOption(S.editorProtocol, ["SSH (Secure Shell)", "SSH"]);
  const port = await $(S.editorPort);
  await port.clearValue();
  await port.setValue(String(SSH_PORT));
  await (await $(S.editorUsername)).setValue("testuser");
  await (await $(S.editorPassword)).setValue("testpass123");
  await (await $(S.editorSave)).click();
  await waitForConnectionItem(name);
}

async function typeCommand(cmd: string): Promise<void> {
  for (const ch of cmd) {
    await browser.keys(ch);
  }
  await browser.keys("Enter");
}

async function reloadApp(): Promise<void> {
  await browser.execute(() => {
    globalThis.location.reload();
  });
  await waitForAppReady();
}

describe("Session reload resilience", () => {
  before(async () => {
    startContainers(["test-ssh"]);
    await waitForContainer("ssh", SSH_PORT, 30_000);
  });

  after(async () => {
    await closeAllSessions().catch(() => undefined);
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("Reload Resilience");
  });

  it("keeps the SSH tab, its backend session and its scrollback across a reload", async () => {
    await createSshConnection("Resilient SSH");
    await openConnectionItem("Resilient SSH");
    await waitForSshConnected();
    await waitForSessionTab("Resilient SSH");

    await typeCommand(`echo ${MARKER}`);
    await waitForSshTerminalText([MARKER]);

    await reloadApp();

    // The tab is back without the user reconnecting.
    await waitForSessionTab("Resilient SSH");
    await waitForSshConnected();

    // Scrollback is replayed from the backend buffer, not re-fetched.
    const text = await waitForSshTerminalText([MARKER]);
    expect(text).toContain(MARKER);

    // Exactly one tab: adoption must not also dial a duplicate session.
    expect(await $$(S.sessionTab).length).toBe(1);

    // And the adopted session is still usable.
    await typeCommand("echo after-reload-ok");
    await waitForSshTerminalText(["after-reload-ok"]);
    expect(await getSshTerminalText()).toContain("after-reload-ok");
  });
});
