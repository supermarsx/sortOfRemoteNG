import { S } from './selectors';

type WaitForTerminalTextOptions = {
  timeout?: number;
  timeoutMsg?: string;
  previousText?: string;
  minOccurrences?: Record<string, number>;
};

const DEFAULT_TIMEOUT = 15_000;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function matchesConnectionName(itemText: string, connectionName: string): boolean {
  const normalized = normalizeText(itemText);
  return normalized === connectionName || normalized.includes(connectionName);
}

async function findConnectionItemByName(
  connectionName: string,
): Promise<WebdriverIO.Element | null> {
  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);

  let partialMatch: WebdriverIO.Element | null = null;
  for (const item of items) {
    const text = await item.getText();
    if (!matchesConnectionName(text, connectionName)) {
      continue;
    }

    if (normalizeText(text) === connectionName) {
      return item;
    }

    partialMatch = item;
  }

  return partialMatch;
}

export function countTextOccurrences(text: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  return text.split(needle).length - 1;
}

export async function getSshTerminalText(): Promise<string> {
  const text = await browser.execute(
    (selector) => document.querySelector(selector)?.textContent ?? '',
    S.sshTerminal,
  );

  return normalizeText(String(text));
}

export async function waitForConnectionItem(
  connectionName: string,
  timeout = 10_000,
): Promise<void> {
  const tree = await $(S.connectionTree);
  await tree.waitForDisplayed({ timeout });

  await browser.waitUntil(
    async () => Boolean(await findConnectionItemByName(connectionName)),
    {
      timeout,
      interval: 250,
      timeoutMsg: `Expected connection "${connectionName}" to appear in the tree`,
    },
  );
}

export async function openConnectionItem(connectionName: string): Promise<void> {
  await waitForConnectionItem(connectionName);

  const item = await findConnectionItemByName(connectionName);
  if (!item) {
    throw new Error(`Connection "${connectionName}" was not found in the tree`);
  }

  await item.doubleClick();
}

export async function waitForSessionTab(
  connectionName: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const tabs = await $$(S.sessionTab);
      for (const tab of tabs) {
        const text = await tab.getText();
        if (matchesConnectionName(text, connectionName)) {
          return true;
        }
      }

      return false;
    },
    {
      timeout,
      interval: 250,
      timeoutMsg: `Expected a session tab for "${connectionName}"`,
    },
  );
}

export async function waitForSshConnected(timeout = DEFAULT_TIMEOUT): Promise<string> {
  const terminal = await $(S.sshTerminal);
  await terminal.waitForDisplayed({ timeout });

  const disconnectBtn = await $(S.terminalDisconnect);
  let text = '';

  await browser.waitUntil(
    async () => {
      text = await getSshTerminalText();
      const disconnectEnabled = await disconnectBtn.isEnabled().catch(() => false);

      return (
        disconnectEnabled &&
        text.includes('Shell started successfully') &&
        text.includes('Connected')
      );
    },
    {
      timeout,
      interval: 250,
      timeoutMsg: 'Expected the SSH terminal to reach the connected shell state',
    },
  );

  return text;
}

export async function waitForSshTerminalText(
  expectedTexts: string[],
  options: WaitForTerminalTextOptions = {},
): Promise<string> {
  const {
    timeout = DEFAULT_TIMEOUT,
    timeoutMsg = `Expected SSH terminal to contain: ${expectedTexts.join(', ')}`,
    previousText,
    minOccurrences = {},
  } = options;

  let text = '';
  await browser.waitUntil(
    async () => {
      text = await getSshTerminalText();

      if (previousText && text === previousText) {
        return false;
      }

      for (const expectedText of expectedTexts) {
        if (!text.includes(expectedText)) {
          return false;
        }
      }

      for (const [needle, minimum] of Object.entries(minOccurrences)) {
        if (countTextOccurrences(text, needle) < minimum) {
          return false;
        }
      }

      return true;
    },
    {
      timeout,
      interval: 250,
      timeoutMsg,
    },
  );

  return text;
}

export async function waitForSshDisconnected(timeout = DEFAULT_TIMEOUT): Promise<string> {
  const disconnectBtn = await $(S.terminalDisconnect);
  const reconnectBtn = await $(S.terminalReconnect);
  let text = '';

  await browser.waitUntil(
    async () => {
      text = await getSshTerminalText();
      const disconnectEnabled = await disconnectBtn.isEnabled().catch(() => false);
      const reconnectVisible = await reconnectBtn.isDisplayed().catch(() => false);
      const reconnectEnabled = await reconnectBtn.isEnabled().catch(() => false);

      return (
        !disconnectEnabled &&
        reconnectVisible &&
        reconnectEnabled &&
        text.includes('Idle') &&
        text.includes('Disconnected from SSH session')
      );
    },
    {
      timeout,
      interval: 250,
      timeoutMsg: 'Expected the SSH terminal to transition to the disconnected idle state',
    },
  );

  return text;
}