import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  closeAllSessions,
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
 * Script Manager → "Run on SSH" streaming output pane (t61).
 *
 * Covers: live streaming (first line visible before the run finishes),
 * follow-scroll pinned to the bottom, wheel scrolling contained inside the
 * pane (no scroll chaining to the page), the "Jump to latest" pill, and the
 * RC-B regression guard (the interactive terminal of the same session keeps
 * accepting input after a script run).
 */

const CONNECTION_NAME = "Script Run Test";
const SCRIPT_NAME = "E2E Stream Lines";
const SCRIPT_BODY = "for i in $(seq 1 60); do echo line-$i; sleep 0.05; done";

async function createAndConnectSSH(): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  await (await $(S.editorName)).setValue(CONNECTION_NAME);
  await (await $(S.editorHostname)).setValue("localhost");
  await selectCustomOption(S.editorProtocol, ["SSH (Secure Shell)", "SSH"]);

  // The numeric port input rejects WebDriver clearValue (it re-clamps on
  // every keystroke), so set it through the native value setter instead.
  const portInput = await $(S.editorPort);
  await browser.execute(
    (selector: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(selector);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!input || !setter) {
        throw new Error(`Unable to set numeric input ${selector}`);
      }
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    S.editorPort,
    String(SSH_PORT),
  );
  await browser.waitUntil(
    async () => (await portInput.getValue()) === String(SSH_PORT),
    { timeout: 5_000, timeoutMsg: `Expected SSH port ${SSH_PORT}` },
  );

  // Credentials live on the "Protocol" tab of the tabbed editor.
  const protocolTab = await $(S.editorTabProtocol);
  await protocolTab.waitForClickable({ timeout: 10_000 });
  await protocolTab.click();

  const usernameInput = await $(S.editorUsername);
  await usernameInput.waitForDisplayed({ timeout: 10_000 });
  await usernameInput.setValue("testuser");

  const passwordInput = await $(S.editorPassword);
  await passwordInput.waitForDisplayed({ timeout: 10_000 });
  await passwordInput.setValue("testpass");

  await (await $(S.editorSave)).click();
  await waitForConnectionItem(CONNECTION_NAME);

  await openConnectionItem(CONNECTION_NAME);
  await acceptHostKeyPrompt();
  await waitForSshConnected();
  await waitForSessionTab(CONNECTION_NAME);
}

/**
 * The fixture regenerates its host keys on every boot, so the first connect
 * raises the "Unknown Host Key" dialog. Accept it (or fall through once the
 * terminal reports the shell is up).
 */
async function acceptHostKeyPrompt(): Promise<void> {
  const dialog = await $('[role="dialog"]');
  const terminal = await $(S.sshTerminal);

  await browser.waitUntil(
    async () => {
      if (await dialog.isDisplayed().catch(() => false)) {
        const text = (await dialog.getText()).replace(/\s+/g, " ").trim();
        // First-use → "Accept & Continue"; a regenerated key against a stale
        // known_hosts entry → "Trust New Host Key & Continue".
        const acceptButton = await dialog.$(
          ".//button[contains(normalize-space(.), '& Continue')]",
        );
        if (!(await acceptButton.isExisting())) {
          throw new Error(`Unexpected dialog during SSH connect: ${text}`);
        }
        await acceptButton.waitForClickable({ timeout: 5_000 });
        await acceptButton.click();
        return true;
      }
      if (await terminal.isDisplayed().catch(() => false)) {
        const text = await getSshTerminalText();
        return (
          text.includes("SSH connection established") ||
          text.includes("Shell started successfully")
        );
      }
      return false;
    },
    {
      timeout: 30_000,
      interval: 200,
      timeoutMsg:
        "Expected the SSH fixture to connect or request host-key approval",
    },
  );
}

/**
 * Activate the session tab whose label contains `label`, and make sure the
 * activation sticks: the app may re-activate the previous session shortly
 * after a tool tab is opened, so re-click until the tab stays selected.
 */
async function activateTab(label: string): Promise<void> {
  const findTab = async () => {
    const tabs = await $$(S.sessionTab);
    for (const tab of tabs) {
      const text = await tab.getText().catch(() => "");
      if (text.includes(label)) return tab;
    }
    return null;
  };
  const isSelected = async () => {
    const tab = await findTab();
    return tab ? (await tab.getAttribute("aria-selected")) === "true" : false;
  };

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const tab = await findTab();
    if (tab) {
      if (!(await isSelected())) await tab.click();
      // Stable for ~1.5 s → accept.
      let stable = true;
      for (let i = 0; i < 5; i++) {
        await browser.pause(300);
        if (!(await isSelected())) {
          stable = false;
          break;
        }
      }
      if (stable) return;
    } else {
      await browser.pause(200);
    }
  }
  throw new Error(`Session tab "${label}" could not be activated`);
}

/**
 * Close every session tab, answering the close-confirmation dialog and
 * waiting for its backdrop to go away before touching the next tab (the
 * shared closeAllSessions helper can race that backdrop).
 */
async function closeSessionsSafely(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const tabs = await $$(S.sessionTab);
    const count = await tabs.length;
    if (count === 0) return;

    const closeBtn = await tabs[count - 1].$(
      '[data-testid="session-tab-close"]',
    );
    await closeBtn.click().catch(() => undefined);

    const confirm = await $(S.confirmDialog);
    const shown = await confirm
      .waitForDisplayed({ timeout: 1_000 })
      .then(() => true)
      .catch(() => false);
    if (shown) {
      await (await $(S.confirmYes)).click();
      await confirm
        .waitForExist({ timeout: 5_000, reverse: true })
        .catch(() => undefined);
    }

    await browser
      .waitUntil(async () => (await (await $$(S.sessionTab)).length) < count, {
        timeout: 5_000,
        interval: 100,
      })
      .catch(() => undefined);
  }
  await closeAllSessions();
}

async function openScriptManager(): Promise<void> {
  const openBtn = await $(S.scriptManagerOpen);
  await openBtn.waitForClickable({ timeout: 5_000 });
  await openBtn.click();

  // The tool opens as a session tab; it is not necessarily activated.
  await activateTab("Script Manager");

  const newScriptBtn = await $(S.scriptManagerNewScript);
  await newScriptBtn.waitForClickable({ timeout: 10_000 });
}

async function createScript(name: string, body: string): Promise<void> {
  await (await $(S.scriptManagerNewScript)).click();

  const nameInput = await $(S.scriptManagerEditName);
  await nameInput.waitForDisplayed({ timeout: 5_000 });
  await nameInput.setValue(name);

  const scriptInput = await $(S.scriptManagerEditScript);
  await scriptInput.setValue(body);

  const saveBtn = await $(S.scriptManagerSave);
  await saveBtn.waitForEnabled({ timeout: 5_000 });
  await saveBtn.click();

  // Saving deselects; pick the new script from the list to open the detail view.
  const listEntry = await $(`span=${name}`);
  await listEntry.waitForDisplayed({ timeout: 5_000 });
  await listEntry.click();

  const runBtn = await $(S.scriptManagerRunOnSsh);
  await runBtn.waitForDisplayed({ timeout: 5_000 });
}

async function startRun(): Promise<void> {
  const runBtn = await $(S.scriptManagerRunOnSsh);
  await runBtn.waitForEnabled({ timeout: 5_000 });
  await runBtn.click();

  const pane = await $(S.scriptOutputPane);
  await pane.waitForDisplayed({ timeout: 5_000 });
}

async function outputText(): Promise<string> {
  return (await $(S.scriptOutputText)).getText();
}

async function exitBadgeExists(): Promise<boolean> {
  return (await $(S.scriptOutputExit)).isExisting();
}

async function waitForRunToFinish(): Promise<void> {
  await browser.waitUntil(exitBadgeExists, {
    timeout: 30_000,
    interval: 200,
    timeoutMsg: "Script run did not finish (exit badge never appeared)",
  });
}

interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

async function scrollerState(): Promise<ScrollState> {
  return browser.execute(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-testid="script-output-scroller"]',
    );
    if (!el) throw new Error("script-output-scroller not found");
    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });
}

/** Sum of scrollTop across the page + every ancestor scroller of the pane. */
async function pageScrollFingerprint(): Promise<number> {
  return browser.execute(() => {
    let total = window.scrollX + window.scrollY;
    let el = document.querySelector<HTMLElement>(
      '[data-testid="script-output-scroller"]',
    )?.parentElement;
    while (el) {
      total += el.scrollTop + el.scrollLeft;
      el = el.parentElement;
    }
    return total;
  });
}

/** Dispatch a wheel-up gesture inside the scroller (deltaY < 0). */
async function wheelUpInsidePane(deltaY: number): Promise<void> {
  const scroller = await $(S.scriptOutputScroller);
  const { x, y } = await scroller.getLocation();
  const { width, height } = await scroller.getSize();
  const cx = Math.round(x + width / 2);
  const cy = Math.round(y + height / 2);

  // WebDriver wheel action (real input path; exercises overscroll-behavior).
  try {
    await browser
      .action("wheel")
      .scroll({ x: cx, y: cy, deltaX: 0, deltaY: -deltaY, duration: 50 })
      .perform();
    return;
  } catch {
    // Fall through to the synthetic path for drivers without wheel actions.
  }

  await browser.execute((dy: number) => {
    const el = document.querySelector<HTMLElement>(
      '[data-testid="script-output-scroller"]',
    );
    if (!el) throw new Error("script-output-scroller not found");
    const evt = new WheelEvent("wheel", {
      deltaY: -dy,
      bubbles: true,
      cancelable: true,
    });
    const defaultAllowed = el.dispatchEvent(evt);
    if (defaultAllowed) {
      el.scrollTop = Math.max(0, el.scrollTop - dy);
    }
  }, deltaY);
}

describe("Script Manager: run on SSH streaming output", () => {
  before(async () => {
    startContainers(["test-ssh"]);
    await waitForContainer("ssh", SSH_PORT, 30_000);
  });

  after(async () => {
    stopContainers(["test-ssh"]);
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("Script Run Test");
  });

  afterEach(async () => {
    await closeSessionsSafely();
  });

  it("streams output live, keeps following, contains scroll, and leaves the terminal usable", async () => {
    await createAndConnectSSH();
    await openScriptManager();
    await createScript(SCRIPT_NAME, SCRIPT_BODY);
    await startRun();

    // --- Live streaming: line-1 shows up while the run is still in flight ---
    let sawFirstLineWhileRunning = false;
    await browser.waitUntil(
      async () => {
        const text = await outputText();
        if (!text.includes("line-1")) return false;
        sawFirstLineWhileRunning = !(await exitBadgeExists());
        return true;
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "line-1 never appeared in the output pane",
      },
    );
    expect(sawFirstLineWhileRunning).toBe(true);
    expect((await outputText()).includes("line-60")).toBe(false);

    // --- Completion: all lines present, scroller pinned to the bottom ---
    await waitForRunToFinish();
    const finalText = await outputText();
    expect(finalText).toContain("line-1\n");
    expect(finalText).toContain("line-60");
    expect(await (await $(S.scriptOutputCancel)).isExisting()).toBe(false);

    const atEnd = await scrollerState();
    expect(atEnd.scrollHeight).toBeGreaterThan(atEnd.clientHeight);
    expect(
      atEnd.scrollHeight - atEnd.scrollTop - atEnd.clientHeight,
    ).toBeLessThanOrEqual(8);
    expect(await (await $(S.scriptOutputFollow)).isExisting()).toBe(false);

    // --- Wheel-up inside the pane: pane scrolls, page does not ---
    const pageBefore = await pageScrollFingerprint();
    const scrollDelta = Math.max(120, Math.round(atEnd.clientHeight / 2));
    await wheelUpInsidePane(scrollDelta);
    await browser.waitUntil(
      async () => (await scrollerState()).scrollTop < atEnd.scrollTop,
      {
        timeout: 3_000,
        interval: 50,
        timeoutMsg: "wheel-up did not decrease the pane scrollTop",
      },
    );
    const afterWheel = await scrollerState();
    expect(afterWheel.scrollTop).toBeLessThan(atEnd.scrollTop);
    expect(await pageScrollFingerprint()).toBe(pageBefore);

    // Scroll offset is preserved (no auto re-pin after leaving the bottom).
    await browser.pause(300);
    expect((await scrollerState()).scrollTop).toBe(afterWheel.scrollTop);

    // --- "Jump to latest" pill appears, then disappears after click ---
    const pill = await $(S.scriptOutputFollow);
    await pill.waitForDisplayed({ timeout: 3_000 });
    await pill.click();
    await browser.waitUntil(
      async () => !(await (await $(S.scriptOutputFollow)).isExisting()),
      {
        timeout: 3_000,
        interval: 50,
        timeoutMsg: '"Jump to latest" pill did not disappear after click',
      },
    );
    const rePinned = await scrollerState();
    expect(
      rePinned.scrollHeight - rePinned.scrollTop - rePinned.clientHeight,
    ).toBeLessThanOrEqual(8);

    // --- RC-B regression guard: interactive terminal still accepts input ---
    await activateTab(CONNECTION_NAME);
    const terminal = await $(S.sshTerminal);
    await terminal.waitForDisplayed({ timeout: 5_000 });
    await terminal.click();
    await browser.pause(300);

    for (const ch of "echo ok_after_script") {
      await browser.keys(ch);
    }
    await browser.keys("Enter");

    // The echoed command line contains the marker once; the executed
    // output line makes it two occurrences.
    await waitForSshTerminalText(["ok_after_script"], {
      timeout: 10_000,
      timeoutMsg: "Terminal did not execute input after the script run (RC-B)",
      minOccurrences: { ok_after_script: 2 },
    });
  });
});
