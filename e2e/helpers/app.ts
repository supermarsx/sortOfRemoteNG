import { S } from './selectors';

export async function waitForAppReady(): Promise<void> {
  const splash = await $(S.splashScreen);
  await splash.waitForExist({ timeout: 30_000, reverse: true });

  const appShell = await $(S.appShell);
  await appShell.waitForExist({ timeout: 30_000 });
}

export async function resetAppState(): Promise<void> {
  await browser.executeAsync((done: (result?: unknown) => void) => {
    // Clear localStorage and sessionStorage
    localStorage.clear();
    sessionStorage.clear();

    // Delete IndexedDB databases containing 'mremote'
    if (indexedDB.databases) {
      indexedDB.databases().then((dbs) => {
        const deletions = dbs
          .filter((db) => db.name && db.name.toLowerCase().includes('mremote'))
          .map(
            (db) =>
              new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(db.name!);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              }),
          );
        Promise.all(deletions).then(() => done());
      });
    } else {
      done();
    }
  });
}

export async function getActiveSessionCount(): Promise<number> {
  const tabs = await $$(S.sessionTab);
  return tabs.length;
}

export async function closeAllSessions(): Promise<void> {
  let tabs = await $$(S.sessionTab);
  while ((await tabs.length) > 0) {
    const closeBtn = await tabs[0].$('[data-testid="session-tab-close"]');
    await closeBtn.click();
    await browser.pause(300);
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
  const createBtn = await $(S.collectionCreate);
  await createBtn.click();

  const nameInput = await $(S.collectionName);
  await nameInput.waitForExist({ timeout: 5_000 });
  await nameInput.setValue(name);

  if (encrypted && password) {
    const pwInput = await $(S.collectionPassword);
    await pwInput.setValue(password);
  }

  const confirmBtn = await $(S.collectionConfirm);
  await confirmBtn.click();

  // Wait for dialog to close
  await nameInput.waitForExist({ timeout: 5_000, reverse: true });
}

export async function openImportExport(): Promise<void> {
  const btn = await $(S.toolbarImportExport);
  await btn.click();
  const dialog = await $(S.importExportDialog);
  await dialog.waitForExist({ timeout: 5_000 });
}
