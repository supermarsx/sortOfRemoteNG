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
  countTextOccurrences,
  openConnectionItem,
  waitForConnectionItem,
} from "../../helpers/ssh";

/** Source-only trust acceptance. Uses synthetic Docker SSH sessions and real
 * WebDriver clicks. Covers connection/everywhere grants, cancel, edit,
 * picker/settings revocation, and bulk trust under Always. Never execute
 * against the user's profile or keychain. Helpers mirror ssh-run-prompt.
 */

// One key per run: names never collide with what an earlier run left in the
// app-wide libraries, and every marker is obviously synthetic.
const RUN = Date.now().toString(36);
const SESSION = `T104 Prompt ${RUN}`;
const HOST = "localhost";

const SCRIPT_NAME = `T104 Run ${RUN}`;
const SCRIPT_TAG = "t104s";
const MACRO_TAG = "t104m";
const PASTE_TAGS = ["t104pa", "t104pb"] as const;
const BULK_TAG = "t104bulk";

/**
 * A harmless `echo` whose output counts its own runs in that shell:
 * `<tag>_1_<RUN>`, then `<tag>_2_<RUN>`. The typed line holds `$((...))` where
 * the output holds the number, so a marker found in the terminal is an
 * execution, never the echoed command line, and it says how many there were.
 */
const countedEcho = (tag: string) => `echo ${tag}_$((${tag}=${tag}+1))_${RUN}`;
const ranTimes = (tag: string, times: number) => `${tag}_${times}_${RUN}`;

// One line, so the terminal sends it to the interactive shell (a multi-line
// script runs in a shell of its own, where the counter would start over).
const SCRIPT_BODY = countedEcho(SCRIPT_TAG);
const MACRO_COMMAND = countedEcho(MACRO_TAG);
const PASTE_LINES = PASTE_TAGS.map(countedEcho);
const PASTED_TEXT = `${PASTE_LINES.join("\n")}\n`;
const BULK_COMMAND = `echo ${BULK_TAG}_$((40+2))_${RUN}`;

const LIVE_LINES = 8;
const liveLine = (index: number) => `t104live_${index}_${RUN}`;

// AppPromptDialog ignores Enter and Space for its first 300 ms, so that a key
// typed before the prompt could be read does not answer it. Pointer clicks
// are not held.
const PROMPT_KEYBOARD_ARM_MS = 300;

// A preview that ends in a line feed shows it as this symbol (U+240A): for a
// paste that line feed decides whether the last line runs.
const FINAL_LINE_FEED = "\u{240A}";

// Controls without a test id: aria-label, placeholder and text based.
const UI = {
  hostKeyAccept:
    "//*[@role='dialog']//button[contains(normalize-space(.), '& Continue')]",
  runScript: 'button[aria-label="Run Script"]',
  scriptPicker: '[data-testid="web-terminal-script-selector-modal"]',
  scriptPickerSearch: 'input[placeholder="Search scripts..."]',
  recordMacro: 'button[aria-label="Record Macro"]',
  stopMacroRecording: 'button[aria-label="Stop Macro Recording"]',
  replayMacro: 'button[aria-label="Replay Macro"]',
  macroPopover: '[data-testid="web-terminal-macro-popover"]',
  fullscreenTrigger: "button[data-session-fullscreen-trigger]",
  fullscreenExit: '[data-testid="session-fullscreen-exit-control"]',
  // App.tsx moves `title` into `data-tooltip` at runtime; match either.
  bulkOpen: 'button[data-tooltip="Bulk SSH"], button[title="Bulk SSH"]',
  bulkScripts: '//button[normalize-space(.)="Scripts"]',
  bulkConfirmRun:
    '//span[normalize-space(.)="Confirm run"]/following-sibling::button[@role="combobox"][1]',
  bulkCommand:
    'textarea[placeholder="Enter command to send to all selected sessions..."]',
  bulkSend: '//button[normalize-space(.)="Send"]',
} as const;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The first match that is on screen. Every open session keeps its terminal
 * and toolbar mounted, hidden while another tab is active, so a plain `$()`
 * can return a control of a session that is not showing.
 */
async function onScreen(selector: string): Promise<WebdriverIO.Element> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    for (const element of await $$(selector)) {
      if (await element.isDisplayed().catch(() => false)) return element;
    }
    if (Date.now() > deadline) {
      throw new Error(`Nothing on screen matches ${selector}`);
    }
    await browser.pause(100);
  }
}

/**
 * Text of the terminal that is on screen. With two sessions open the shared
 * `getSshTerminalText` reads the first terminal in the document, whichever
 * tab is active.
 */
async function terminalText(): Promise<string> {
  const text = await browser.execute((selector: string) => {
    const terminal = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    ).find(
      (candidate) =>
        getComputedStyle(candidate).visibility === "visible" &&
        candidate.getClientRects().length > 0,
    );
    return terminal?.textContent ?? "";
  }, S.sshTerminal);

  return oneLine(String(text));
}

async function waitForTerminalText(
  expected: string,
  timeoutMsg = `Expected the terminal to show ${expected}`,
): Promise<string> {
  let text = "";
  await browser.waitUntil(
    async () => {
      text = await terminalText();
      return text.includes(expected);
    },
    { timeout: 15_000, interval: 250, timeoutMsg },
  );
  return text;
}

/** True while the keyboard focus is inside a terminal's canvas. */
function terminalHasKeyboard(): Promise<boolean> {
  return browser.execute(
    (selector: string) => Boolean(document.activeElement?.closest(selector)),
    S.terminalCanvas,
  );
}

async function typeInTerminal(line: string): Promise<void> {
  await (await onScreen(S.terminalCanvas)).click();
  await browser.waitUntil(terminalHasKeyboard, {
    timeout: 5_000,
    interval: 50,
    timeoutMsg: "The terminal did not take the keyboard focus",
  });

  for (const ch of line) {
    await browser.keys(ch);
  }
  await browser.keys("Enter");
}

let settles = 0;

/**
 * Runs one more command and waits for its output. The shell works through
 * its input in order, so whatever was sent before has been echoed and run by
 * then: "nothing was sent" and "it ran once" can be read off the returned
 * text without a fixed wait.
 */
async function settleTerminal(): Promise<string> {
  settles += 1;
  await typeInTerminal(`echo t104done_${settles}_$((40+2))_${RUN}`);
  return waitForTerminalText(
    `t104done_${settles}_42_${RUN}`,
    "The terminal did not run a command typed after the prompt closed",
  );
}

/** Starts lines the shell prints on its own for a few seconds: nobody types them. */
async function startLiveOutput(): Promise<void> {
  await typeInTerminal(
    `(for i in $(seq ${LIVE_LINES}); do sleep 1.5; echo t104live_\${i}_${RUN}; done) &`,
  );
}

function liveLinesSeen(text: string): number {
  let seen = 0;
  for (let index = 1; index <= LIVE_LINES; index += 1) {
    if (text.includes(liveLine(index))) seen = index;
  }
  return seen;
}

/** A new line of `startLiveOutput` is drawn while the prompt is on screen. */
async function expectOutputBehindPrompt(): Promise<void> {
  const seen = liveLinesSeen(await terminalText());
  // Otherwise no line is left to arrive and the wait below proves nothing.
  expect(seen).toBeLessThan(LIVE_LINES);

  await browser.waitUntil(
    async () => liveLinesSeen(await terminalText()) > seen,
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg:
        "The terminal stopped drawing output while the prompt was open",
    },
  );
  expect(await (await $(S.appPrompt)).isDisplayed()).toBe(true);
}

async function createSshConnection(
  name: string,
  hostname: string,
): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  await (await $(S.editorName)).setValue(name);
  await (await $(S.editorHostname)).setValue(hostname);
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
  await waitForConnectionItem(name);
}

async function findSessionTab(
  label: string,
): Promise<WebdriverIO.Element | null> {
  for (const tab of await $$(S.sessionTab)) {
    const text = await tab.getText().catch(() => "");
    if (text.includes(label)) return tab;
  }
  return null;
}

/**
 * Activate the session tab whose label contains `label`, and make sure the
 * activation sticks: the app may re-activate the previous session shortly
 * after a tool tab is opened, so re-click until the tab stays selected.
 */
async function activateTab(label: string): Promise<void> {
  const isSelected = async () => {
    const tab = await findSessionTab(label);
    return tab ? (await tab.getAttribute("aria-selected")) === "true" : false;
  };

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const tab = await findSessionTab(label);
    if (tab) {
      if (!(await isSelected())) await tab.click();
      // Stable for ~1.5 s: accept.
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
 * Opens the connection and waits for its shell. The fixture regenerates its
 * host keys on every boot, so a first connect to a host raises the "Unknown
 * Host Key" dialog: accept it whenever it shows.
 */
async function connectSsh(name: string): Promise<void> {
  await openConnectionItem(name);
  await browser.waitUntil(
    async () => {
      const accept = await $(UI.hostKeyAccept);
      if (await accept.isDisplayed().catch(() => false)) {
        await accept.click();
        return false;
      }
      const tab = await findSessionTab(name);
      return (
        tab !== null &&
        (await tab.getAttribute("data-session-status")) === "connected"
      );
    },
    {
      timeout: 30_000,
      interval: 200,
      timeoutMsg: `Expected "${name}" to connect or request host-key approval`,
    },
  );

  await activateTab(name);
  await waitForTerminalText(
    "Shell started successfully",
    `Expected the shell of "${name}" to start`,
  );
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

    const closeBtn = await tabs[count - 1].$(S.sessionTabClose);
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

/** Waits for the themed prompt and returns its title (its accessible name). */
async function waitForPrompt(): Promise<string> {
  const prompt = await $(S.appPrompt);
  await prompt.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: "The in-app prompt did not appear",
  });
  const title = await (await $(S.appPromptDialog)).getAttribute("aria-label");
  return oneLine(title ?? "");
}

/**
 * The "Session" row under the message: the session's name, then its host.
 * Two sessions can share a name, so the title alone does not say where.
 */
async function expectSessionRow(name: string, hostname: string): Promise<void> {
  const row = oneLine(await (await $(S.appPromptTargets)).getText());
  expect(row).toBe(`${name} ${hostname}`);
}

/** The preview's text without the symbol that stands for a final line feed. */
async function previewWithoutFinalLineFeed(): Promise<string> {
  const preview = await (await $(S.appPromptPreview)).getText();
  return preview.endsWith(FINAL_LINE_FEED)
    ? preview.slice(0, -FINAL_LINE_FEED.length)
    : preview;
}

async function waitForPromptGone(): Promise<void> {
  await (
    await $(S.appPrompt)
  ).waitForExist({
    timeout: 5_000,
    reverse: true,
    timeoutMsg: "The in-app prompt did not close",
  });
}

/** Leaves nothing modal or fullscreen behind for the tab cleanup and the next spec. */
async function dismissLeftovers(): Promise<void> {
  if (await browser.isAlertOpen().catch(() => false)) {
    await browser.dismissAlert();
  }

  const cancel = await $(S.appPromptCancel);
  if (await cancel.isExisting()) {
    await cancel.click();
    await waitForPromptGone();
  }

  for (const overlay of [UI.fullscreenExit, UI.scriptPicker]) {
    if (await (await $(overlay)).isExisting()) {
      await browser.keys("Escape");
      await (await $(overlay)).waitForExist({ timeout: 5_000, reverse: true });
    }
  }
}

/** Saves an app-wide script, the library the terminal's script picker lists. */
async function saveScript(name: string, body: string): Promise<void> {
  const openBtn = await $(S.scriptManagerOpen);
  await openBtn.waitForClickable({ timeout: 5_000 });
  await openBtn.click();

  // The tool opens as a session tab; it is not necessarily activated.
  await activateTab("Script Manager");

  const newScriptBtn = await $(S.scriptManagerNewScript);
  await newScriptBtn.waitForClickable({ timeout: 10_000 });
  await newScriptBtn.click();

  const nameInput = await $(S.scriptManagerEditName);
  await nameInput.waitForDisplayed({ timeout: 5_000 });
  await nameInput.setValue(name);
  await (await $(S.scriptManagerEditScript)).setValue(body);

  const saveBtn = await $(S.scriptManagerSave);
  await saveBtn.waitForEnabled({ timeout: 5_000 });
  await saveBtn.click();

  const listEntry = await $(`span=${name}`);
  await listEntry.waitForDisplayed({ timeout: 5_000 });
}

const scriptRow = (name: string) =>
  $(UI.scriptPicker).$(`.//button[.//span[normalize-space(.)="${name}"]]`);

/**
 * Opens the picker from the toolbar and filters it down to `name`. The picker
 * opens for typing: its search box has the keyboard, not the first control of
 * the dialog (the header's close button).
 */
async function openScriptPicker(name: string): Promise<void> {
  await (await onScreen(UI.runScript)).click();
  const picker = await $(UI.scriptPicker);
  await picker.waitForDisplayed({ timeout: 5_000 });

  const search = await picker.$(UI.scriptPickerSearch);
  await browser.waitUntil(() => search.isFocused(), {
    timeout: 5_000,
    timeoutMsg:
      "Expected the script picker to open with the keyboard in its search box",
  });
  // Closing the picker clears its search, so every opening filters again.
  await search.setValue(name);
}

/** Clicks the script's row in the picker, opening the picker first if needed. */
async function pickScript(name: string): Promise<void> {
  const picker = await $(UI.scriptPicker);
  if (!(await picker.isDisplayed().catch(() => false))) {
    await openScriptPicker(name);
  }

  const row = await scriptRow(name);
  await row.waitForClickable({ timeout: 10_000 });
  await row.click();
}

async function closeMacroList(): Promise<void> {
  const popover = await $(UI.macroPopover);
  if (await popover.isDisplayed().catch(() => false)) {
    await (await onScreen(UI.replayMacro)).click();
    await popover.waitForDisplayed({ timeout: 5_000, reverse: true });
  }
}

/** The rows of the replay list, opened first if needed, with each macro's name. */
async function macroRows(): Promise<
  { name: string; row: WebdriverIO.Element }[]
> {
  const popover = await $(UI.macroPopover);
  if (!(await popover.isDisplayed().catch(() => false))) {
    const toggle = await onScreen(UI.replayMacro);
    await toggle.waitForEnabled({ timeout: 10_000 });
    await toggle.click();
    await popover.waitForDisplayed({ timeout: 5_000 });
  }

  const rows: { name: string; row: WebdriverIO.Element }[] = [];
  for (const row of await $$(`${UI.macroPopover} button`)) {
    rows.push({ name: oneLine(await (await row.$("div")).getText()), row });
  }
  return rows;
}

async function macroNames(): Promise<string[]> {
  return (await macroRows()).map(({ name }) => name);
}

/**
 * Records `command` as a one-step macro with the toolbar's recorder, which
 * also runs it once, and returns the name the app gave the macro. The
 * app-wide library can hold macros of earlier runs, so the new one is the
 * name that was not listed before.
 */
async function recordMacro(command: string, tag: string): Promise<string> {
  const known = await macroNames();
  await closeMacroList();

  const record = await onScreen(UI.recordMacro);
  await record.waitForEnabled({ timeout: 10_000 });
  await record.click();
  await onScreen(UI.stopMacroRecording);

  await typeInTerminal(command);
  await waitForTerminalText(ranTimes(tag, 1));
  await (await onScreen(UI.stopMacroRecording)).click();

  let name = "";
  await browser.waitUntil(
    async () => {
      name =
        (await macroNames()).find((listed) => !known.includes(listed)) ?? "";
      return name !== "";
    },
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: "The recorded macro never appeared in the replay list",
    },
  );
  await closeMacroList();
  return name;
}

async function replayMacro(name: string): Promise<void> {
  const listed = (await macroRows()).find((macro) => macro.name === name);
  if (!listed) throw new Error(`Macro "${name}" is not in the replay list`);
  await listed.row.click();
}

/**
 * Dispatches a `paste` event on the terminal that is on screen. The event
 * carries its own `clipboardData`, built here in the page from `text`: the
 * system clipboard is never read or written and no paste shortcut is sent.
 */
async function pasteIntoTerminal(text: string): Promise<void> {
  const intercepted = await browser.execute(
    (terminalSelector: string, canvasSelector: string, pasted: string) => {
      const terminal = Array.from(
        document.querySelectorAll<HTMLElement>(terminalSelector),
      ).find(
        (candidate) =>
          getComputedStyle(candidate).visibility === "visible" &&
          candidate.getClientRects().length > 0,
      );
      const canvas = terminal?.querySelector<HTMLElement>(canvasSelector);
      if (!canvas) throw new Error("No terminal on screen to paste into");

      // Where a real paste lands: the terminal's own input, inside the canvas.
      const target = canvas.querySelector<HTMLElement>("textarea") ?? canvas;
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (format: string) => (format === "text/plain" ? pasted : ""),
        },
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
    S.sshTerminal,
    S.terminalCanvas,
    text,
  );

  // The terminal's paste handler took the event; nothing else handled it.
  expect(intercepted).toBe(true);
}

/** Both lines, and the mark for the line feed that makes the second one run. */
async function expectPastePreview(): Promise<void> {
  const preview = await (await $(S.appPromptPreview)).getText();
  expect(preview).toContain(PASTE_LINES[0]);
  expect(preview.endsWith(`${PASTE_LINES[1]}${FINAL_LINE_FEED}`)).toBe(true);
}

async function expectNothingPasted(): Promise<void> {
  const text = await settleTerminal();
  for (const tag of PASTE_TAGS) {
    expect(countTextOccurrences(text, `${tag}_`)).toBe(0);
  }
}

async function expectBothLinesPastedOnce(): Promise<void> {
  await waitForTerminalText(ranTimes(PASTE_TAGS[1], 1));
  const text = await settleTerminal();
  for (const tag of PASTE_TAGS) {
    expect(countTextOccurrences(text, ranTimes(tag, 1))).toBe(1);
    expect(countTextOccurrences(text, ranTimes(tag, 2))).toBe(0);
  }
}

/** Opens the commander and makes every named session a command recipient. */
async function openBulkCommander(sessions: string[]): Promise<void> {
  const openBtn = await $(UI.bulkOpen);
  await openBtn.waitForClickable({ timeout: 5_000 });
  await openBtn.click();

  // The tool opens as a session tab; it is not necessarily activated.
  await activateTab("Bulk SSH");

  for (const name of sessions) {
    const recipient = await $(
      `button[aria-label="Remove ${name} from command recipients"], button[aria-label="Add ${name} to command recipients"]`,
    );
    await recipient.waitForDisplayed({ timeout: 10_000 });
    if ((await recipient.getAttribute("aria-pressed")) !== "true") {
      await recipient.click();
    }
    await browser.waitUntil(
      async () => (await recipient.getAttribute("aria-pressed")) === "true",
      {
        timeout: 5_000,
        timeoutMsg: `Expected "${name}" to be a command recipient`,
      },
    );
  }
}

/** Sets "Confirm run" in the commander's script library panel. */
async function setBulkRunPolicy(
  label: "Always" | "Destructive",
): Promise<void> {
  await activateTab("Bulk SSH");

  const trigger = await $(UI.bulkConfirmRun);
  const libraryToggle = await onScreen(UI.bulkScripts);
  if (!(await trigger.isDisplayed().catch(() => false))) {
    await libraryToggle.click();
  }

  await selectCustomOption(UI.bulkConfirmRun, label);
  await browser.waitUntil(
    async () => oneLine(await trigger.getText()) === label,
    { timeout: 5_000, timeoutMsg: `Expected "Confirm run" to be ${label}` },
  );

  // The open panel leaves little room for the command editor below it.
  await libraryToggle.click();
  await trigger.waitForDisplayed({ timeout: 5_000, reverse: true });
}

/** SOURCE ONLY. Do not run against the user's profile or keychain. */
async function chooseLastingTrust(choice: "connection" | "everywhere") {
  await waitForPrompt();
  await browser.pause(PROMPT_KEYBOARD_ARM_MS + 100);
  // WebDriver click is trusted; browser.execute(...click()) cannot grant.
  await (await $(`${S.appPromptChoice}[value="${choice}"]`)).click();
  await (await $(S.appPromptConfirm)).click();
  await waitForPromptGone();
}
async function revokePickerTrust() {
  await openScriptPicker(SCRIPT_NAME);
  await (await $(S.trustedScriptRevoke)).waitForClickable({ timeout: 5000 });
  await (await $(S.trustedScriptRevoke)).click();
  await (
    await $(S.trustedScriptMark)
  ).waitForExist({ timeout: 5000, reverse: true });
  await browser.keys("Escape");
}
async function prepareTrustSessions() {
  await createSshConnection(SESSION, HOST);
  await connectSsh(SESSION);
  await createSshConnection(`${SESSION} other`, HOST);
  await connectSsh(`${SESSION} other`);
  await saveScript(SCRIPT_NAME, SCRIPT_BODY);
  await activateTab(SESSION);
}
describe("permanently trusted SSH scripts", () => {
  before(async () => {
    startContainers(["test-ssh"]);
    await waitForContainer("ssh", SSH_PORT, 30000);
  });
  after(async () => {
    stopContainers(["test-ssh"]);
  });
  beforeEach(async () => {
    await resetAppState();
    await createCollection("Script Trust Test");
  });
  afterEach(async () => {
    await dismissLeftovers().catch(() => undefined);
    await closeSessionsSafely();
  });
  it("trusts this connection, runs once more without asking, and asks on the other connection", async () => {
    await prepareTrustSessions();
    try {
      await pickScript(SCRIPT_NAME);
      await chooseLastingTrust("connection");
      await waitForTerminalText(ranTimes(SCRIPT_TAG, 1));
      await pickScript(SCRIPT_NAME);
      await waitForTerminalText(ranTimes(SCRIPT_TAG, 2));
      expect(await (await $(S.appPrompt)).isExisting()).toBe(false);
      expect(
        countTextOccurrences(await settleTerminal(), ranTimes(SCRIPT_TAG, 2)),
      ).toBe(1);
      await activateTab(`${SESSION} other`);
      await pickScript(SCRIPT_NAME);
      await waitForPrompt();
      await (await $(S.appPromptCancel)).click();
      await waitForPromptGone();
      await browser.keys("Escape");
      await activateTab(SESSION);
    } finally {
      await dismissLeftovers();
      await activateTab(SESSION);
      await revokePickerTrust();
    }
  });
  it("trusts everywhere, so the other connection runs without a prompt", async () => {
    await prepareTrustSessions();
    try {
      await pickScript(SCRIPT_NAME);
      await chooseLastingTrust("everywhere");
      await waitForTerminalText(ranTimes(SCRIPT_TAG, 1));
      await activateTab(`${SESSION} other`);
      await pickScript(SCRIPT_NAME);
      await waitForTerminalText(ranTimes(SCRIPT_TAG, 1));
      expect(await (await $(S.appPrompt)).isExisting()).toBe(false);
    } finally {
      await dismissLeftovers();
      await activateTab(SESSION);
      await revokePickerTrust();
    }
  });
  it("Cancel with a lasting answer selected grants nothing", async () => {
    await prepareTrustSessions();
    await pickScript(SCRIPT_NAME);
    await waitForPrompt();
    await (await $(`${S.appPromptChoice}[value="everywhere"]`)).click();
    await (await $(S.appPromptCancel)).click();
    await waitForPromptGone();
    await pickScript(SCRIPT_NAME);
    await waitForPrompt();
    expect(
      countTextOccurrences(await terminalText(), ranTimes(SCRIPT_TAG, 1)),
    ).toBe(0);
    await (await $(S.appPromptCancel)).click();
    await waitForPromptGone();
  });
  it("revoking on the picker asks again and does not run the script", async () => {
    await prepareTrustSessions();
    await pickScript(SCRIPT_NAME);
    await chooseLastingTrust("everywhere");
    await waitForTerminalText(ranTimes(SCRIPT_TAG, 1));
    await revokePickerTrust();
    await pickScript(SCRIPT_NAME);
    await waitForPrompt();
    expect(
      countTextOccurrences(await terminalText(), ranTimes(SCRIPT_TAG, 2)),
    ).toBe(0);
    await (await $(S.appPromptCancel)).click();
    await waitForPromptGone();
  });
  it("a script edit asks again and Settings revoke clears the grant", async () => {
    await prepareTrustSessions();
    await pickScript(SCRIPT_NAME);
    await chooseLastingTrust("everywhere");
    try {
      await activateTab("Script Manager");
      await (await $(`span=${SCRIPT_NAME}`)).click();
      await (
        await $(S.scriptManagerEditScript)
      ).setValue(`${SCRIPT_BODY} # changed`);
      await (await $(S.scriptManagerSave)).click();
      await activateTab(SESSION);
      await pickScript(SCRIPT_NAME);
      await waitForPrompt();
      await (await $(S.appPromptCancel)).click();
      await waitForPromptGone();
      await browser.keys("Escape");
    } finally {
      await dismissLeftovers();
      await (await $(S.toolbarSettings)).click();
      await (await $('[data-testid="settings-tab-macros"]')).click();
      const row = await $(
        `//*[@data-testid="trusted-scripts-row"][.//*[@data-testid="trusted-scripts-name" and normalize-space(.)="${SCRIPT_NAME}"]]`,
      );
      await (await row.$(S.trustedScriptsRevoke)).click();
      await row.waitForExist({ timeout: 5000, reverse: true });
      await browser.keys("Escape");
    }
    await pickScript(SCRIPT_NAME);
    await waitForPrompt();
    await (await $(S.appPromptCancel)).click();
    await waitForPromptGone();
  });
  it("a trusted bulk library script under Always sends without a prompt and explains why", async () => {
    await prepareTrustSessions();
    await (await onScreen(UI.bulkOpen)).click();
    await setBulkRunPolicy("Always");
    await (await onScreen(UI.bulkScripts)).click();
    const load = await $('button[aria-label="Load Uptime"]');
    await load.waitForClickable({ timeout: 5000 });
    await load.click();
    await (await onScreen(UI.bulkSend)).click();
    await chooseLastingTrust("everywhere");
    try {
      await (await onScreen(UI.bulkScripts)).click();
      await (await $('button[aria-label="Load Uptime"]')).click();
      await (await onScreen(UI.bulkSend)).click();
      await browser.waitUntil(
        async () =>
          (await $$(".toast-item").map((item) => item.getText())).some((text) =>
            text.includes("trusted"),
          ),
        { timeout: 5000 },
      );
      expect(await (await $(S.appPrompt)).isExisting()).toBe(false);
    } finally {
      await (await onScreen(UI.bulkScripts)).click();
      await (await $(S.trustedScriptRevoke)).click();
    }
  });
});
