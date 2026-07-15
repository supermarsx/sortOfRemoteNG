import { S } from "./selectors";

type WindowSnapshot = {
  hasAppShell: boolean;
  hasPrimaryWorkspace: boolean;
  hasCriticalError: boolean;
  hasSplash: boolean;
  hasWelcome: boolean;
  hasTauriInvoke: boolean;
  href: string;
};

async function getWindowSnapshot(): Promise<WindowSnapshot> {
  return browser.execute(() => ({
    hasAppShell: document.querySelector('[data-testid="app-shell"]') !== null,
    hasPrimaryWorkspace:
      document.querySelector('[data-testid="toolbar-new-connection"]') !== null,
    hasCriticalError:
      document.querySelector('[data-testid="critical-error-screen"]') !== null,
    hasSplash: document.querySelector('[data-testid="splash-screen"]') !== null,
    hasWelcome:
      document.querySelector('[data-testid="welcome-screen"]') !== null,
    hasTauriInvoke:
      typeof (globalThis as { __TAURI__?: { core?: { invoke?: unknown } } })
        .__TAURI__?.core?.invoke === "function",
    href: window.location.href,
  }));
}

function isNativeSplashDocument(snapshot: WindowSnapshot): boolean {
  return snapshot.href.startsWith("data:text/html");
}

async function dismissNativeSplash(
  snapshot?: WindowSnapshot,
): Promise<boolean> {
  const currentSnapshot =
    snapshot ?? (await getWindowSnapshot().catch(() => null));
  if (
    !currentSnapshot ||
    !isNativeSplashDocument(currentSnapshot) ||
    !currentSnapshot.hasTauriInvoke
  ) {
    return false;
  }

  const closed = await browser.executeAsync(
    (done: (result: boolean) => void) => {
      const tauri = (
        globalThis as {
          __TAURI__?: { core?: { invoke?: (cmd: string) => Promise<unknown> } };
        }
      ).__TAURI__;
      const invoke = tauri?.core?.invoke;
      if (typeof invoke !== "function") {
        done(false);
        return;
      }

      invoke("close_splash")
        .then(() => done(true))
        .catch(() => done(false));
    },
  );

  if (closed) {
    await browser.pause(500);
  }

  return closed;
}

async function ensureAppWindowSelected(): Promise<void> {
  let fallbackHandle: string | undefined;

  for (let pass = 0; pass < 3; pass += 1) {
    const handles = await browser.getWindowHandles();

    for (const handle of [...handles].reverse()) {
      try {
        await browser.switchToWindow(handle);
        const snapshot = await getWindowSnapshot();
        if (snapshot.hasPrimaryWorkspace) {
          return;
        }
        if (
          !fallbackHandle &&
          (snapshot.hasAppShell ||
            snapshot.hasCriticalError ||
            snapshot.hasSplash ||
            snapshot.hasWelcome)
        ) {
          fallbackHandle = handle;
        }

        if (isNativeSplashDocument(snapshot)) {
          const dismissed = await dismissNativeSplash(snapshot);
          if (dismissed) {
            break;
          }

          continue;
        }

        if (snapshot.href && snapshot.href !== "about:blank") {
          fallbackHandle ??= handle;
        }
      } catch {
        // Ignore transient handles while the Tauri webview is switching documents.
      }
    }
    fallbackHandle ??= handles.at(-1);
  }

  if (fallbackHandle) {
    await browser.switchToWindow(fallbackHandle);
  }
}

export async function closeDetachedAppWindows(): Promise<void> {
  const handles = await browser.getWindowHandles();
  if (handles.length <= 1) return;

  let primaryHandle: string | undefined;
  for (const handle of handles) {
    await browser.switchToWindow(handle).catch(() => undefined);
    const snapshot = await getWindowSnapshot().catch(() => null);
    if (snapshot?.hasPrimaryWorkspace) {
      primaryHandle = handle;
      break;
    }
  }
  if (!primaryHandle) return;

  for (const handle of handles) {
    if (handle === primaryHandle) continue;
    await browser.switchToWindow(handle).catch(() => undefined);
    await browser.closeWindow().catch(() => undefined);
  }
  await browser.switchToWindow(primaryHandle);
}

export async function waitForAppReady(): Promise<void> {
  await browser.waitUntil(
    async () => {
      await ensureAppWindowSelected();

      const snapshot = await getWindowSnapshot().catch(() => null);
      return Boolean(
        snapshot &&
        (snapshot.hasAppShell ||
          snapshot.hasCriticalError ||
          snapshot.hasSplash ||
          snapshot.hasWelcome),
      );
    },
    {
      timeout: 30_000,
      interval: 250,
      timeoutMsg: "Expected the Tauri app window to become available",
    },
  );

  const splash = await $(S.splashScreen);
  if (await splash.isExisting().catch(() => false)) {
    await splash.waitForExist({ timeout: 30_000, reverse: true });
  }

  await ensureAppWindowSelected();
  const appShell = await $(S.appShell);
  await appShell.waitForExist({ timeout: 30_000 });
}

export async function resetAppState(): Promise<void> {
  await closeDetachedAppWindows().catch(() => undefined);
  await ensureAppWindowSelected();

  await closeAllSessions().catch(() => undefined);

  await browser.executeAsync((done: (result?: unknown) => void) => {
    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      done();
    };

    const fallback = globalThis.setTimeout(finish, 1_000);

    try {
      globalThis.localStorage?.clear();
    } catch {
      // Ignore storage access failures during test reset.
    }

    try {
      globalThis.sessionStorage?.clear();
    } catch {
      // Ignore storage access failures during test reset.
    }

    try {
      if (!indexedDB.databases) {
        globalThis.clearTimeout(fallback);
        finish();
        return;
      }

      indexedDB
        .databases()
        .then((dbs) => {
          const deletions = dbs
            .filter(
              (db) => db.name && db.name.toLowerCase().includes("mremote"),
            )
            .map(
              (db) =>
                new Promise<void>((resolve) => {
                  const req = indexedDB.deleteDatabase(db.name!);
                  req.onsuccess = () => resolve();
                  req.onerror = () => resolve();
                  req.onblocked = () => resolve();
                }),
            );

          Promise.all(deletions)
            .catch(() => undefined)
            .then(() => {
              globalThis.clearTimeout(fallback);
              finish();
            });
        })
        .catch(() => {
          globalThis.clearTimeout(fallback);
          finish();
        });
    } catch {
      globalThis.clearTimeout(fallback);
      finish();
    }
  });

  await browser.execute(() => {
    globalThis.location.reload();
  });

  await waitForAppReady();
}

export async function getActiveSessionCount(): Promise<number> {
  const tabs = await $$(S.sessionTab);
  return tabs.length;
}

export async function closeAllSessions(): Promise<void> {
  let tabs = await $$(S.sessionTab);
  let attemptsRemaining = Math.max(4, (await tabs.length) * 2);
  while ((await tabs.length) > 0) {
    if (attemptsRemaining-- <= 0) {
      throw new Error("Session tabs did not close within the bounded cleanup");
    }
    const previousCount = await tabs.length;
    const closeBtn = await tabs[0].$('[data-testid="session-tab-close"]');
    await closeBtn.click();
    const confirm = await $(S.confirmDialog);
    if (await confirm.isDisplayed().catch(() => false)) {
      await (await $(S.confirmYes)).click();
    }
    await browser
      .waitUntil(
        async () => {
          const remainingTabs = await $$(S.sessionTab);
          return (await remainingTabs.length) < previousCount;
        },
        {
          timeout: 3_000,
          interval: 100,
          timeoutMsg: "Session tab did not close after confirmation",
        },
      )
      .catch(() => undefined);
    tabs = await $$(S.sessionTab);
  }
}

export async function openSettings(): Promise<void> {
  const btn = await $(S.toolbarSettings);
  await btn.click();
  const dialog = await $(S.settingsDialog);
  await dialog.waitForExist({ timeout: 5_000 });
}

export async function closeSettings(): Promise<void> {
  const btn = await $(S.modalClose);
  await btn.click();
  const dialog = await $(S.settingsDialog);
  await dialog.waitForExist({ timeout: 5_000, reverse: true });
}

export async function createCollection(
  name: string,
  encrypted?: boolean,
  password?: string,
): Promise<void> {
  await ensureAppWindowSelected();

  const collectionSelector = await $(S.collectionSelector);
  const modernCreate = await $('[data-testid="database-create"]');
  if (
    !(await collectionSelector.isDisplayed().catch(() => false)) &&
    !(await modernCreate.isDisplayed().catch(() => false))
  ) {
    const toolbarButton = await $(S.toolbarCollection);
    await toolbarButton.waitForClickable({ timeout: 10_000 });
    await toolbarButton.click();
    await browser.waitUntil(
      async () =>
        (await collectionSelector.isDisplayed().catch(() => false)) ||
        (await modernCreate.isDisplayed().catch(() => false)),
      {
        timeout: 10_000,
        timeoutMsg: "Expected the collection manager to open",
      },
    );
  }

  if (await modernCreate.isDisplayed().catch(() => false)) {
    await modernCreate.waitForClickable({ timeout: 10_000 });
    await modernCreate.click();

    const nameInput = await $('[data-testid="database-name"]');
    await nameInput.waitForDisplayed({ timeout: 5_000 });
    await nameInput.setValue(name);

    if (encrypted && password) {
      const encryptionToggle = await $(
        '//*[@data-testid="database-name"]/ancestor::div[contains(@class,"space-y-3")][1]//*[@role="checkbox" or @type="checkbox"]',
      );
      await encryptionToggle.click();
      const passwordInputs = await $$('input[type="password"]');
      if ((await passwordInputs.length) < 2) {
        throw new Error("Expected collection password and confirmation fields");
      }
      await passwordInputs[0].setValue(password);
      await passwordInputs[1].setValue(password);
    }

    const confirm = await $('[data-testid="database-confirm"]');
    await confirm.waitForClickable({ timeout: 5_000 });
    await confirm.click();
    await browser.waitUntil(
      async () => {
        const newConnection = await $(S.toolbarNewConnection);
        return (await newConnection.getAttribute("disabled")) === null;
      },
      {
        timeout: 10_000,
        timeoutMsg: "Expected the new collection to become active",
      },
    );
    await closeAllSessions();
    return;
  }

  const createBtn = await $(S.collectionCreate);
  await createBtn.waitForClickable({ timeout: 10_000 });
  await createBtn.click();

  const nameInput = await $(S.collectionName);
  await nameInput.waitForExist({ timeout: 5_000 });
  await nameInput.setValue(name);

  if (encrypted && password) {
    const pwInput = await $(S.collectionPassword);
    await pwInput.setValue(password);
  }

  const confirmBtn = await $(S.collectionConfirm);
  await confirmBtn.waitForClickable({ timeout: 5_000 });
  await confirmBtn.click();

  await collectionSelector.waitForDisplayed({ timeout: 10_000, reverse: true });
}

export async function openImportExport(): Promise<void> {
  const btn = await $(S.toolbarImportExport);
  await btn.click();
  const dialog = await $(S.importExportDialog);
  await dialog.waitForExist({ timeout: 5_000 });
}
