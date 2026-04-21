import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openImportExport } from '../../helpers/app';

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

describe('Export Connections', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Export Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    // Create 3 test connections
    await addTestConnection('Web Server', '10.0.0.1', 'SSH');
    await addTestConnection('Database', '10.0.0.2', 'SSH');
    await addTestConnection('Jump Host', '10.0.0.3', 'RDP');
  });

  it('should open export tab in import/export dialog', async () => {
    await openExportTab();
    const exportConfirm = await $(S.exportConfirm);
    expect(await exportConfirm.isExisting()).toBe(true);
  });

  it('should export as JSON', async () => {
    await openExportTab();

    const formatSelect = await $(S.exportFormat);
    await formatSelect.selectByVisibleText('JSON');

    // Track downloads via browser
    const downloadsBefore = await browser.execute(() => {
      (window as any).__lastDownload = null;
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag: string) {
        const el = origCreate(tag);
        if (tag === 'a') {
          const origClick = el.click.bind(el);
          el.click = function () {
            (window as any).__lastDownload = (el as HTMLAnchorElement).download || true;
            origClick();
          };
        }
        return el;
      };
      return null;
    });

    const confirmBtn = await $(S.exportConfirm);
    await confirmBtn.click();
    await browser.pause(1000);

    const downloadTriggered = await browser.execute(
      () => (window as any).__lastDownload != null,
    );
    expect(downloadTriggered).toBe(true);
  });

  it('should export as CSV', async () => {
    await openExportTab();

    const formatSelect = await $(S.exportFormat);
    await formatSelect.selectByVisibleText('CSV');

    await browser.execute(() => {
      (window as any).__lastDownload = null;
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag: string) {
        const el = origCreate(tag);
        if (tag === 'a') {
          const origClick = el.click.bind(el);
          el.click = function () {
            (window as any).__lastDownload = (el as HTMLAnchorElement).download || true;
            origClick();
          };
        }
        return el;
      };
      return null;
    });

    const confirmBtn = await $(S.exportConfirm);
    await confirmBtn.click();
    await browser.pause(1000);

    const downloadTriggered = await browser.execute(
      () => (window as any).__lastDownload != null,
    );
    expect(downloadTriggered).toBe(true);
  });

  it('should export as mRemoteNG-compatible XML', async () => {
    await openExportTab();

    const formatSelect = await $(S.exportFormat);
    await formatSelect.selectByVisibleText('mRemoteNG XML');

    await browser.execute(() => {
      (window as any).__lastDownload = null;
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag: string) {
        const el = origCreate(tag);
        if (tag === 'a') {
          const origClick = el.click.bind(el);
          el.click = function () {
            (window as any).__lastDownload = (el as HTMLAnchorElement).download || true;
            origClick();
          };
        }
        return el;
      };
      return null;
    });

    const confirmBtn = await $(S.exportConfirm);
    await confirmBtn.click();
    await browser.pause(1000);

    const downloadTriggered = await browser.execute(
      () => (window as any).__lastDownload != null,
    );
    expect(downloadTriggered).toBe(true);
  });

  it('should toggle "include passwords" option', async () => {
    await openExportTab();

    const toggle = await $(S.exportEncrypt);
    const initialState = await toggle.isSelected();

    await toggle.click();
    await browser.pause(300);
    const newState = await toggle.isSelected();
    expect(newState).not.toBe(initialState);

    // Toggle back
    await toggle.click();
    await browser.pause(300);
    const restoredState = await toggle.isSelected();
    expect(restoredState).toBe(initialState);
  });

  it('should use a filename following the naming convention', async () => {
    await openExportTab();

    const formatSelect = await $(S.exportFormat);
    await formatSelect.selectByVisibleText('JSON');

    // Intercept the download filename
    await browser.execute(() => {
      (window as any).__downloadFilename = null;
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag: string) {
        const el = origCreate(tag);
        if (tag === 'a') {
          const origClick = el.click.bind(el);
          el.click = function () {
            (window as any).__downloadFilename = (el as HTMLAnchorElement).download;
            origClick();
          };
        }
        return el;
      };
      return null;
    });

    const confirmBtn = await $(S.exportConfirm);
    await confirmBtn.click();
    await browser.pause(1000);

    const filename: string | null = await browser.execute(
      () => (window as any).__downloadFilename,
    );
    expect(filename).toBeTruthy();
    // Filename should contain the collection name and a timestamp or date pattern
    expect(filename!.toLowerCase()).toContain('export');
  });
});
