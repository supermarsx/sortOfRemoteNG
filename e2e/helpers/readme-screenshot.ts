import fs from "node:fs";
import path from "node:path";
import { selectCustomOption } from "./forms";
import { S } from "./selectors";
import {
  getSshTerminalText,
  waitForConnectionItem,
  waitForSessionTab,
  waitForSshConnected,
  waitForSshTerminalText,
} from "./ssh";

export const README_COLLECTION_NAME = "README Demo";
export const README_CONNECTION_NAME = "Prototype SSH";
export const README_SSH_HOST = "localhost";
export const README_SSH_PORT = 2222;
export const README_SSH_USERNAME = "testuser";
export const README_SSH_PASSWORD = "testpass";
export const README_SCREENSHOT_WIDTH = 1280;
export const README_SCREENSHOT_HEIGHT = 720;

type LoadEnvelope<T> = {
  source: string;
  value: T;
};

type CollectionSummary = {
  id: string;
  name: string;
};

type StoredConnection = {
  authType?: string;
  hostname?: string;
  id: string;
  name: string;
  password?: string;
  port?: number;
  protocol?: string;
  username?: string;
};

type StoredCollection = {
  connections?: StoredConnection[];
};

export type ReadmeSeed = {
  collectionId: string;
  connectionId: string;
};

export type LaunchArgs = {
  collection_id?: string | null;
  connection_id?: string | null;
};

type InvokeResult<T> = {
  ok: boolean;
  value?: T;
  error?: string;
};

async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const response = await browser.executeAsync<
    InvokeResult<T>,
    [string, Record<string, unknown> | undefined]
  >(
    (
      invokeCommand: string,
      invokeArgs: Record<string, unknown> | undefined,
      done: (result?: InvokeResult<T>) => void,
    ) => {
      const tauri = globalThis as {
        __TAURI__?: {
          core?: {
            invoke?: (
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<T>;
          };
        };
        __TAURI_INTERNALS__?: {
          invoke?: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<T>;
        };
      };
      const invoke =
        tauri.__TAURI__?.core?.invoke ?? tauri.__TAURI_INTERNALS__?.invoke;

      if (typeof invoke !== "function") {
        done({ ok: false, error: "Tauri invoke is unavailable" });
        return;
      }

      invoke(invokeCommand, invokeArgs)
        .then((value) => done({ ok: true, value }))
        .catch((error: unknown) =>
          done({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    command,
    args,
  );

  if (!response?.ok) {
    throw new Error(
      `Tauri command ${command} failed: ${response?.error ?? "unknown error"}`,
    );
  }

  return response.value as T;
}

async function createReadmeConnection(): Promise<void> {
  const addButton = await $(S.toolbarNewConnection);
  await addButton.waitForClickable({ timeout: 10_000 });
  await addButton.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 10_000 });

  await (await $(S.editorName)).setValue(README_CONNECTION_NAME);
  await (await $(S.editorHostname)).setValue(README_SSH_HOST);
  await selectCustomOption(S.editorProtocol, ["SSH (Secure Shell)", "SSH"]);

  const portInput = await $(S.editorPort);
  await browser.execute(
    (selector, value) => {
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
    String(README_SSH_PORT),
  );
  await browser.waitUntil(
    async () => (await portInput.getValue()) === String(README_SSH_PORT),
    {
      timeout: 5_000,
      timeoutMsg: `Expected SSH port ${README_SSH_PORT}`,
    },
  );

  const protocolTab = await $('[data-testid="connection-editor-tab-protocol"]');
  await protocolTab.waitForClickable({ timeout: 10_000 });
  await protocolTab.click();

  const usernameInput = await $(S.editorUsername);
  await usernameInput.waitForDisplayed({ timeout: 10_000 });
  await usernameInput.setValue(README_SSH_USERNAME);

  const passwordInput = await $(S.editorPassword);
  await passwordInput.waitForDisplayed({ timeout: 10_000 });
  await passwordInput.setValue(README_SSH_PASSWORD);

  const saveButton = await $(S.editorSave);
  await saveButton.waitForClickable({ timeout: 10_000 });
  await saveButton.click();
  await waitForConnectionItem(README_CONNECTION_NAME, 15_000);
}

async function createReadmeCollection(): Promise<void> {
  const databasesButton = await $(S.toolbarCollection);
  await databasesButton.waitForClickable({ timeout: 10_000 });
  await databasesButton.click();

  const createButton = await $('[data-testid="database-create"]');
  await createButton.waitForClickable({ timeout: 10_000 });
  await createButton.click();

  const nameInput = await $('[data-testid="database-name"]');
  await nameInput.waitForDisplayed({ timeout: 10_000 });
  await nameInput.setValue(README_COLLECTION_NAME);

  const confirmButton = await $('[data-testid="database-confirm"]');
  await confirmButton.waitForClickable({ timeout: 10_000 });
  await confirmButton.click();

  await nameInput.waitForExist({ reverse: true, timeout: 15_000 });
}

async function findConnectionId(): Promise<string> {
  const items = await $$(S.connectionItem);
  for (const item of items) {
    const text = (await item.getText()).replace(/\s+/g, " ").trim();
    if (!text.includes(README_CONNECTION_NAME)) {
      continue;
    }

    const idElement = await item.$("[data-connection-id]");
    const connectionId = await idElement
      .getAttribute("data-connection-id")
      .catch(() => null);
    if (connectionId) {
      return connectionId;
    }
  }

  throw new Error(
    `Unable to resolve the persisted ID for ${README_CONNECTION_NAME}`,
  );
}

async function findCollectionId(): Promise<string> {
  const envelope = await invokeTauri<LoadEnvelope<CollectionSummary[]> | null>(
    "databases_list",
  );
  const collection = envelope?.value.find(
    (candidate) => candidate.name === README_COLLECTION_NAME,
  );

  if (!collection?.id) {
    throw new Error(
      `Unable to resolve the persisted ID for ${README_COLLECTION_NAME}`,
    );
  }

  return collection.id;
}

async function waitForPersistedConnection(
  collectionId: string,
  expectedConnectionId: string,
): Promise<void> {
  let observedConnection: StoredConnection | undefined;

  try {
    await browser.waitUntil(
      async () => {
        const envelope =
          await invokeTauri<LoadEnvelope<StoredCollection> | null>(
            "load_database_data",
            { databaseId: collectionId },
          ).catch(() => null);
        observedConnection = envelope?.value.connections?.find(
          (connection) => connection.id === expectedConnectionId,
        );

        return (
          observedConnection?.name === README_CONNECTION_NAME &&
          observedConnection.protocol === "ssh" &&
          observedConnection.hostname === README_SSH_HOST &&
          Number(observedConnection.port) === README_SSH_PORT &&
          observedConnection.username === README_SSH_USERNAME &&
          observedConnection.authType === "password" &&
          observedConnection.password === README_SSH_PASSWORD
        );
      },
      {
        timeout: 15_000,
        interval: 250,
        timeoutMsg: "Expected the README SSH fixture to be persisted on disk",
      },
    );
  } catch (error) {
    const summary = observedConnection
      ? {
          id: observedConnection.id,
          name: observedConnection.name,
          protocol: observedConnection.protocol,
          hostname: observedConnection.hostname,
          port: observedConnection.port,
          username: observedConnection.username,
          authType: observedConnection.authType,
          passwordLength: observedConnection.password?.length ?? 0,
        }
      : null;
    throw new Error(
      `README SSH fixture persistence mismatch: ${JSON.stringify(summary)}`,
      { cause: error },
    );
  }
}

export async function seedReadmeDemo(): Promise<ReadmeSeed> {
  await createReadmeCollection();
  await createReadmeConnection();

  const [collectionId, connectionId] = await Promise.all([
    findCollectionId(),
    findConnectionId(),
  ]);
  await waitForPersistedConnection(collectionId, connectionId);

  return { collectionId, connectionId };
}

export async function readLaunchArgs(): Promise<LaunchArgs> {
  return invokeTauri<LaunchArgs>("get_launch_args");
}

async function getViewportMetrics(): Promise<{
  width: number;
  height: number;
  devicePixelRatio: number;
}> {
  return browser.execute(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
}

export async function setReadmeViewport(): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const viewport = await getViewportMetrics();
    if (
      viewport.width === README_SCREENSHOT_WIDTH &&
      viewport.height === README_SCREENSHOT_HEIGHT
    ) {
      return;
    }

    const rect = await browser.getWindowRect();
    await browser.setWindowRect(
      rect.x,
      rect.y,
      Math.max(1, rect.width + README_SCREENSHOT_WIDTH - viewport.width),
      Math.max(1, rect.height + README_SCREENSHOT_HEIGHT - viewport.height),
    );
    await browser.pause(250);
  }

  const viewport = await getViewportMetrics();
  throw new Error(
    `Unable to set README viewport to ${README_SCREENSHOT_WIDTH}x${README_SCREENSHOT_HEIGHT}; ` +
      `got ${viewport.width}x${viewport.height} at DPR ${viewport.devicePixelRatio}`,
  );
}

async function typeTerminalCommand(command: string): Promise<void> {
  const terminalCanvas = await $(S.terminalCanvas);
  await terminalCanvas.waitForDisplayed({ timeout: 15_000 });
  await terminalCanvas.click();

  for (const character of command) {
    await browser.keys(character);
  }
  await browser.keys("Enter");
}

async function acceptReadmeHostKeyPrompt(): Promise<void> {
  const dialog = await $('[role="dialog"]');
  const terminal = await $(S.sshTerminal);

  await browser.waitUntil(
    async () => {
      if (await dialog.isDisplayed().catch(() => false)) {
        const text = (await dialog.getText()).replace(/\s+/g, " ").trim();
        if (
          !text.includes("Unknown Host Key") ||
          !text.includes(`${README_SSH_HOST}:${README_SSH_PORT}`)
        ) {
          throw new Error(
            `Unexpected dialog during README SSH launch: ${text}`,
          );
        }

        const rememberCheckbox = await dialog.$('input[type="checkbox"]');
        if (!(await rememberCheckbox.isSelected())) {
          await rememberCheckbox.click();
        }

        const acceptButton = await dialog.$(
          ".//button[normalize-space(.)='Accept & Continue']",
        );
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
        "Expected the local SSH fixture to connect or request first-use host-key approval",
    },
  );
}

export async function renderReadmeTerminal(): Promise<void> {
  await acceptReadmeHostKeyPrompt();
  await waitForSshConnected(60_000);
  await waitForSessionTab(README_CONNECTION_NAME, 30_000);
  await typeTerminalCommand("/bin/sh /fixtures/readme-demo.sh");
  await waitForSshTerminalText(["Prototype environment is ready."], {
    timeout: 30_000,
    timeoutMsg:
      "Expected deterministic README fixture output in the SSH terminal",
  });
}

export async function settleReadmeCapture(): Promise<void> {
  await browser.execute(() => {
    const styleId = "readme-capture-determinism";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0s !important;
          transition-delay: 0s !important;
          transition-duration: 0s !important;
          caret-color: transparent !important;
        }
        .xterm-cursor-layer { visibility: hidden !important; }
        /* Hide accepted host-key metadata only; actionable status badges stay visible. */
        [data-testid="ssh-terminal"] .app-badge[title^="Host key"]:not(.app-badge--error):not(.app-badge--warning),
        [data-testid="ssh-terminal"] .app-badge[title^="SHA-256:"],
        [data-testid="ssh-terminal"] > .app-bar > div:last-child > span:nth-of-type(n+3):not(.app-badge--error):not(.app-badge--warning):not(.app-badge--info) {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    window.scrollTo(0, 0);
  });

  await browser.executeAsync((done: () => void) => {
    const finishOnFrames = () =>
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    const imagesReady = Promise.all(
      Array.from(document.images).map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete) {
              resolve();
              return;
            }

            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    );

    Promise.all([fontsReady, imagesReady])
      .then(finishOnFrames)
      .catch(finishOnFrames);
  });
  await browser.pause(500);
}

export async function assertCaptureIsSettled(): Promise<void> {
  const result = await browser.execute(
    (selectors) => {
      const isVisible = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      return {
        criticalError: isVisible(
          document.querySelector(selectors.criticalError),
        ),
        errorBoundary: isVisible(
          document.querySelector(selectors.errorBoundary),
        ),
        splash: isVisible(document.querySelector(selectors.splash)),
        welcome: isVisible(document.querySelector(selectors.welcome)),
        busyElements: Array.from(
          document.querySelectorAll('[aria-busy="true"]'),
        ).filter(isVisible).length,
        visibleDialogs: Array.from(
          document.querySelectorAll('[role="dialog"]'),
        ).filter(isVisible).length,
        volatileStatusBadges: Array.from(
          document.querySelectorAll(
            '[data-testid="ssh-terminal"] > .app-bar > div:last-child > span:nth-of-type(n+3)',
          ),
        ).filter(isVisible).length,
      };
    },
    {
      criticalError: S.criticalError,
      errorBoundary: S.errorBoundary,
      splash: S.splashScreen,
      welcome: S.welcomeScreen,
    },
  );

  const transientStates = Object.entries(result)
    .filter(
      ([, value]) => value === true || (typeof value === "number" && value > 0),
    )
    .map(([name, value]) => `${name}=${value}`);
  if (transientStates.length > 0) {
    throw new Error(
      `README capture still contains transient UI: ${transientStates.join(", ")}`,
    );
  }
}

export async function saveReadmeScreenshot(filePath: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  await browser.saveScreenshot(resolvedPath);
}
