import path from 'path';
import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openImportExport } from '../../helpers/app';

const EXPORT_PASSWORD = 'Exp0rt!Encrypt#2026';

async function addTestConnection(
  name: string,
  hostname: string,
  protocol: string,
): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  await (await $(S.editorName)).setValue(name);
  await (await $(S.editorHostname)).setValue(hostname);
  await (await $(S.editorProtocol)).selectByVisibleText(protocol);
  await (await $(S.editorSave)).click();
  await browser.pause(500);
}

async function openExportTab(): Promise<void> {
  await openImportExport();
  const exportTab = await $(S.exportTab);
  await exportTab.click();
  await browser.pause(300);
}

async function exportWithEncryption(
  format: string,
  password: string,
): Promise<string | null> {
  await openExportTab();

  const formatSelect = await $(S.exportFormat);
  await formatSelect.selectByVisibleText(format);

  // Enable encryption
  const encryptToggle = await $(S.exportEncrypt);
  if (!(await encryptToggle.isSelected())) {
    await encryptToggle.click();
    await browser.pause(300);
  }

  // Enter password
  const pwInput = await $(S.exportPassword);
  await pwInput.waitForDisplayed({ timeout: 3_000 });
  await pwInput.setValue(password);

  // Intercept the download blob content
  await browser.execute(() => {
    (window as any).__exportedBlob = null;
    (window as any).__exportedFilename = null;
    const origCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob: Blob) {
      if (blob instanceof Blob) {
        blob.text().then((text) => {
          (window as any).__exportedBlob = text;
        });
      }
      return origCreateObjectURL(blob);
    };
    const origCreate = document.createElement.bind(document);
    document.createElement = function (tag: string) {
      const el = origCreate(tag);
      if (tag === 'a') {
        const origClick = el.click.bind(el);
        el.click = function () {
          (window as any).__exportedFilename =
            (el as HTMLAnchorElement).download || null;
          origClick();
        };
      }
      return el;
    };
  });

  const confirmBtn = await $(S.exportConfirm);
  await confirmBtn.click();
  await browser.pause(2000);

  return browser.execute(() => (window as any).__exportedBlob as string | null);
}

describe('Export Encryption', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Crypto Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await addTestConnection('Encrypted Host 1', '10.1.1.1', 'SSH');
    await addTestConnection('Encrypted Host 2', '10.1.1.2', 'RDP');
  });

  it('should export with encryption enabled and password set', async () => {
    const exportedContent = await exportWithEncryption('JSON', EXPORT_PASSWORD);
    expect(exportedContent).toBeTruthy();

    // Encrypted content should NOT contain plaintext hostnames
    expect(exportedContent).not.toContain('10.1.1.1');
    expect(exportedContent).not.toContain('Encrypted Host 1');
  });

  it('should prompt for password when importing an encrypted export', async () => {
    const exportedContent = await exportWithEncryption('JSON', EXPORT_PASSWORD);
    expect(exportedContent).toBeTruthy();

    // Now import the encrypted file by injecting blob content
    await openImportExport();
    const importTab = await $(S.importTab);
    await importTab.click();
    await browser.pause(300);

    // Simulate providing the encrypted content via the file input
    const fileInput = await $(S.importFileInput);
    await browser.execute(
      (selector: string, content: string) => {
        const input = document.querySelector(selector) as HTMLInputElement;
        if (!input) return;
        const blob = new Blob([content], { type: 'application/json' });
        const file = new File([blob], 'encrypted-export.json', {
          type: 'application/json',
        });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      S.importFileInput,
      exportedContent!,
    );

    await browser.pause(1000);

    // A password prompt should appear for the encrypted import
    const passwordDialog = await $(S.passwordDialog);
    await passwordDialog.waitForDisplayed({ timeout: 10_000 });
    expect(await passwordDialog.isDisplayed()).toBe(true);
  });

  it('should decrypt and import with correct password', async () => {
    const exportedContent = await exportWithEncryption('JSON', EXPORT_PASSWORD);
    expect(exportedContent).toBeTruthy();

    // Reset and create fresh collection for import
    await resetAppState();
    await createCollection('Import Encrypted');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await openImportExport();
    const importTab = await $(S.importTab);
    await importTab.click();
    await browser.pause(300);

    // Provide the encrypted file
    await browser.execute(
      (selector: string, content: string) => {
        const input = document.querySelector(selector) as HTMLInputElement;
        if (!input) return;
        const blob = new Blob([content], { type: 'application/json' });
        const file = new File([blob], 'encrypted-export.json', {
          type: 'application/json',
        });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      S.importFileInput,
      exportedContent!,
    );
    await browser.pause(1000);

    // Enter the correct password
    const passwordDialog = await $(S.passwordDialog);
    await passwordDialog.waitForDisplayed({ timeout: 10_000 });
    const passwordInput = await $(S.passwordInput);
    await passwordInput.setValue(EXPORT_PASSWORD);
    const submitBtn = await $(S.passwordSubmit);
    await submitBtn.click();
    await browser.pause(2000);

    // Preview should show connections
    const preview = await $(S.importPreview);
    await preview.waitForDisplayed({ timeout: 10_000 });
    const previewText = await preview.getText();
    expect(previewText).toContain('2');

    // Confirm import
    const confirmBtn = await $(S.importConfirm);
    await confirmBtn.click();
    await browser.pause(1000);

    const treeItems = await $$(S.connectionItem);
    expect(treeItems.length).toBeGreaterThanOrEqual(2);
  });

  it('should show error when wrong password is used for encrypted import', async () => {
    const exportedContent = await exportWithEncryption('JSON', EXPORT_PASSWORD);
    expect(exportedContent).toBeTruthy();

    await resetAppState();
    await createCollection('Wrong Password Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await openImportExport();
    const importTab = await $(S.importTab);
    await importTab.click();
    await browser.pause(300);

    await browser.execute(
      (selector: string, content: string) => {
        const input = document.querySelector(selector) as HTMLInputElement;
        if (!input) return;
        const blob = new Blob([content], { type: 'application/json' });
        const file = new File([blob], 'encrypted-export.json', {
          type: 'application/json',
        });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      S.importFileInput,
      exportedContent!,
    );
    await browser.pause(1000);

    // Enter wrong password
    const passwordDialog = await $(S.passwordDialog);
    await passwordDialog.waitForDisplayed({ timeout: 10_000 });
    const passwordInput = await $(S.passwordInput);
    await passwordInput.setValue('TotallyWrongP@ss');
    const submitBtn = await $(S.passwordSubmit);
    await submitBtn.click();
    await browser.pause(1000);

    // Error should be shown — dialog stays open or error element appears
    const dialogStillVisible = await passwordDialog.isDisplayed();
    const errorExists = await browser.execute(() => {
      const el = document.querySelector(
        '[data-testid="password-error"], [role="alert"], .error-message',
      );
      return el !== null;
    });

    expect(dialogStillVisible || errorExists).toBe(true);
  });
});
