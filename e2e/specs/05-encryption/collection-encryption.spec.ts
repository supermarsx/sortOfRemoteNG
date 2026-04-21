import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

const TEST_PASSWORD = 'Str0ng!P@ssw0rd#2026';

describe('Collection Encryption', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  it('should create an encrypted collection with a password', async () => {
    await createCollection('Encrypted Vault', true, TEST_PASSWORD);

    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
    expect(await tree.isExisting()).toBe(true);
  });

  it('should store data encrypted in IndexedDB (not plaintext)', async () => {
    await createCollection('Encrypted Vault', true, TEST_PASSWORD);
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    // Add a connection so there's meaningful data to inspect
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    await (await $(S.editorName)).setValue('Secret Server');
    await (await $(S.editorHostname)).setValue('192.168.99.99');
    await (await $(S.editorProtocol)).selectByVisibleText('SSH');
    await (await $(S.editorSave)).click();
    await browser.pause(1000);

    // Read raw IndexedDB values and check that plaintext hostname is NOT present
    const containsPlaintext: boolean = await browser.execute(async () => {
      const dbs = await indexedDB.databases();
      for (const dbInfo of dbs) {
        if (!dbInfo.name) continue;
        try {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(dbInfo.name!);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const storeNames = Array.from(db.objectStoreNames);
          for (const storeName of storeNames) {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const allRecords = await new Promise<any[]>((resolve, reject) => {
              const req = store.getAll();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            const raw = JSON.stringify(allRecords);
            if (raw.includes('192.168.99.99') || raw.includes('Secret Server')) {
              db.close();
              return true;
            }
          }
          db.close();
        } catch {
          // skip databases that can't be opened
        }
      }
      return false;
    });

    // Plaintext should NOT appear in raw IndexedDB storage for encrypted collections
    expect(containsPlaintext).toBe(false);
  });

  it('should show error when wrong password is provided', async () => {
    await createCollection('Locked Vault', true, TEST_PASSWORD);
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    // Reload the page to simulate re-opening the app
    await browser.reloadSession();
    await browser.pause(2000);

    // The app should prompt for the collection password
    const passwordDialog = await $(S.passwordDialog);
    await passwordDialog.waitForDisplayed({ timeout: 10_000 });

    const passwordInput = await $(S.passwordInput);
    await passwordInput.setValue('WrongPassword!');

    const submitBtn = await $(S.passwordSubmit);
    await submitBtn.click();
    await browser.pause(1000);

    // An error message or the dialog should remain visible
    const dialogStillVisible = await passwordDialog.isDisplayed();
    const errorExists = await browser.execute(() => {
      const el = document.querySelector(
        '[data-testid="password-error"], [role="alert"], .error-message',
      );
      return el !== null;
    });

    expect(dialogStillVisible || errorExists).toBe(true);
  });

  it('should unlock collection with correct password after reload', async () => {
    await createCollection('Locked Vault', true, TEST_PASSWORD);
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    // Add a connection
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    await (await $(S.editorName)).setValue('Verified Host');
    await (await $(S.editorHostname)).setValue('10.10.10.10');
    await (await $(S.editorProtocol)).selectByVisibleText('SSH');
    await (await $(S.editorSave)).click();
    await browser.pause(1000);

    // Reload
    await browser.reloadSession();
    await browser.pause(2000);

    const passwordDialog = await $(S.passwordDialog);
    await passwordDialog.waitForDisplayed({ timeout: 10_000 });

    const passwordInput = await $(S.passwordInput);
    await passwordInput.setValue(TEST_PASSWORD);

    const submitBtn = await $(S.passwordSubmit);
    await submitBtn.click();
    await browser.pause(2000);

    // Tree should load and contain the connection
    const treeAfter = await $(S.connectionTree);
    await treeAfter.waitForExist({ timeout: 10_000 });

    const items = await treeAfter.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('Verified Host');
  });

  it('should allow changing the collection password (re-encryption)', async () => {
    const NEW_PASSWORD = 'N3w$ecure#Pass!';

    await createCollection('Rekey Vault', true, TEST_PASSWORD);
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    // Add a connection for verification
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    await (await $(S.editorName)).setValue('Rekey Test');
    await (await $(S.editorHostname)).setValue('172.16.0.1');
    await (await $(S.editorProtocol)).selectByVisibleText('SSH');
    await (await $(S.editorSave)).click();
    await browser.pause(1000);

    // Open settings to change password
    const settingsBtn = await $(S.toolbarSettings);
    await settingsBtn.click();
    const settingsDialog = await $(S.settingsDialog);
    await settingsDialog.waitForExist({ timeout: 5_000 });

    // Navigate to collection/security settings and change password
    // The UI may vary — search for a password change option
    const searchInput = await $(S.settingsSearch);
    if (await searchInput.isExisting()) {
      await searchInput.setValue('password');
      await browser.pause(500);
    }

    const collectionPassword = await $(S.collectionPassword);
    if (await collectionPassword.isExisting()) {
      await collectionPassword.clearValue();
      await collectionPassword.setValue(NEW_PASSWORD);
      const confirmBtn = await $(S.collectionConfirm);
      await confirmBtn.click();
      await browser.pause(2000);
    }

    // Close settings
    const closeBtn = await $(S.modalClose);
    await closeBtn.click();
    await browser.pause(500);

    // Reload and use new password
    await browser.reloadSession();
    await browser.pause(2000);

    const passwordDialog = await $(S.passwordDialog);
    await passwordDialog.waitForDisplayed({ timeout: 10_000 });

    const passwordInput = await $(S.passwordInput);
    await passwordInput.setValue(NEW_PASSWORD);
    const submitBtn = await $(S.passwordSubmit);
    await submitBtn.click();
    await browser.pause(2000);

    // Connection should still exist after re-key
    const treeAfter = await $(S.connectionTree);
    await treeAfter.waitForExist({ timeout: 10_000 });
    const items = await treeAfter.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('Rekey Test');
  });
});
