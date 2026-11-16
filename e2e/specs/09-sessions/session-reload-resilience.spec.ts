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
 * earlier terminal output is replayed from the backend buffer. The unified
 * `list_live_sessions` registry must show exactly one SSH session before and
 * after the reload (no duplicate dial), re-claimed by the reloaded window's
 * heartbeat so the orphan grace reaper leaves it alone.
 */

interface LiveRow {
  protocol: string;
  backendSessionId: string;
  state: string;
  orphan?: { claimed: boolean; unclaimedForSecs: number };
}

async function listLiveSessions(): Promise<LiveRow[]> {
  const result = await browser.executeAsync<
    { ok: boolean; value?: LiveRow[]; error?: string },
    []
  >((done) => {
    const tauri = globalThis as {
      __TAURI_INTERNALS__?: { invoke?: (c: string) => Promise<LiveRow[]> };
    };
    const invoke = tauri.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") {
      done({ ok: false, error: "Tauri invoke is unavailable" });
      return;
    }
    invoke("list_live_sessions")
      .then((value) => done({ ok: true, value }))
      .catch((e: unknown) => done({ ok: false, error: String(e) }));
  });
  if (!result.ok) throw new Error(result.error ?? "list_live_sessions failed");
  return result.value ?? [];
}

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

    const before = (await listLiveSessions()).filter(
      (row) => row.protocol === "ssh",
    );
    expect(before).toHaveLength(1);

    await reloadApp();

    // The tab is back without the user reconnecting.
    await waitForSessionTab("Resilient SSH");
    await waitForSshConnected();

    // Scrollback is replayed from the backend buffer, not re-fetched.
    const text = await waitForSshTerminalText([MARKER]);
    expect(text).toContain(MARKER);

    // Exactly one tab: adoption must not also dial a duplicate session.
    expect(await $$(S.sessionTab).length).toBe(1);

    // Same backend session, still exactly one, and claimed by this window
    // again (the heartbeat runs every 5 s; give it a moment).
    await browser.waitUntil(
      async () => {
        const rows = (await listLiveSessions()).filter(
          (row) => row.protocol === "ssh",
        );
        return (
          rows.length === 1 &&
          rows[0].backendSessionId === before[0].backendSessionId &&
          rows[0].orphan?.claimed === true
        );
      },
      {
        timeout: 20_000,
        interval: 1_000,
        timeoutMsg: "SSH session was not adopted/re-claimed after reload",
      },
    );

    // And the adopted session is still usable.
    await typeCommand("echo after-reload-ok");
    await waitForSshTerminalText(["after-reload-ok"]);
    expect(await getSshTerminalText()).toContain("after-reload-ok");
  });
});
