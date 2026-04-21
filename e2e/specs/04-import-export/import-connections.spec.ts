import path from 'path';
import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openImportExport } from '../../helpers/app';

const fixturesDir = path.resolve(__dirname, '../../helpers/fixtures');

async function importFixture(filename: string): Promise<void> {
  await openImportExport();

  const importTab = await $(S.importTab);
  await importTab.click();

  const fileInput = await $(S.importFileInput);
  const fixturePath = path.resolve(fixturesDir, filename);
  await fileInput.setValue(fixturePath);

  const preview = await $(S.importPreview);
  await preview.waitForDisplayed({ timeout: 10_000 });
}

async function confirmImport(): Promise<void> {
  const confirmBtn = await $(S.importConfirm);
  await confirmBtn.click();
  await browser.pause(1000);
}

describe('Import Connections', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Import Test');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should open import/export dialog from toolbar', async () => {
    await openImportExport();
    const dialog = await $(S.importExportDialog);
    await dialog.waitForDisplayed({ timeout: 5_000 });
    expect(await dialog.isDisplayed()).toBe(true);
  });

  it('should import mRemoteNG XML and show connections in preview', async () => {
    await importFixture('mremoteng-export.xml');

    const previewText = await (await $(S.importPreview)).getText();
    // mRemoteNG fixture contains 6 connections in 2 containers
    expect(previewText).toContain('6');

    await confirmImport();

    const treeItems = await $$(S.connectionItem);
    expect(treeItems.length).toBeGreaterThanOrEqual(6);
  });

  it('should import CSV connections', async () => {
    await importFixture('csv-connections.csv');

    const previewText = await (await $(S.importPreview)).getText();
    expect(previewText).toContain('5');

    await confirmImport();

    const treeItems = await $$(S.connectionItem);
    expect(treeItems.length).toBeGreaterThanOrEqual(5);
  });

  it('should import PuTTY registry export', async () => {
    await importFixture('putty-export.reg');

    const previewText = await (await $(S.importPreview)).getText();
    expect(previewText).toContain('3');

    await confirmImport();

    const treeItems = await $$(S.connectionItem);
    expect(treeItems.length).toBeGreaterThanOrEqual(3);
  });

  it('should import Royal TS JSON', async () => {
    await importFixture('royalts-export.json');

    const preview = await $(S.importPreview);
    expect(await preview.isDisplayed()).toBe(true);

    await confirmImport();

    const treeItems = await $$(S.connectionItem);
    expect(treeItems.length).toBeGreaterThanOrEqual(2);
  });

  it('should import Termius JSON', async () => {
    await importFixture('termius-export.json');

    const previewText = await (await $(S.importPreview)).getText();
    expect(previewText).toContain('3');

    await confirmImport();

    const treeItems = await $$(S.connectionItem);
    expect(treeItems.length).toBeGreaterThanOrEqual(3);
  });

  it('should import MobaXterm INI', async () => {
    await importFixture('mobaxterm-export.ini');

    const preview = await $(S.importPreview);
    expect(await preview.isDisplayed()).toBe(true);

    await confirmImport();

    const treeItems = await $$(S.connectionItem);
    expect(treeItems.length).toBeGreaterThanOrEqual(1);
  });

  it('should import SecureCRT XML', async () => {
    await importFixture('securecrt-export.xml');

    const preview = await $(S.importPreview);
    expect(await preview.isDisplayed()).toBe(true);

    await confirmImport();

    const treeItems = await $$(S.connectionItem);
    expect(treeItems.length).toBeGreaterThanOrEqual(1);
  });

  it('should import plain JSON', async () => {
    await importFixture('connections.json');

    const preview = await $(S.importPreview);
    expect(await preview.isDisplayed()).toBe(true);

    await confirmImport();

    const treeItems = await $$(S.connectionItem);
    expect(treeItems.length).toBeGreaterThanOrEqual(1);
  });

  it('should auto-detect import format from file content', async () => {
    await importFixture('mremoteng-export.xml');

    const formatSelect = await $(S.exportFormat);
    if (await formatSelect.isExisting()) {
      const selectedFormat = await formatSelect.getValue();
      expect(selectedFormat.toLowerCase()).toContain('mremoteng');
    }
  });

  it('should show connection and folder count in preview before confirming', async () => {
    await importFixture('mremoteng-export.xml');

    const previewText = await (await $(S.importPreview)).getText();
    // Preview should show both connection and folder counts
    expect(previewText).toMatch(/\d+\s*connection/i);
    expect(previewText).toMatch(/\d+\s*folder/i);
  });

  it('should add imported connections to the tree after confirm', async () => {
    await importFixture('csv-connections.csv');

    const treeBefore = await $$(S.connectionItem);
    const countBefore = await treeBefore.length;

    await confirmImport();

    const treeAfter = await $$(S.connectionItem);
    expect(treeAfter.length).toBeGreaterThan(countBefore);
  });
});
