import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

async function createSynologyConnection(): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue('Test NAS');

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('192.168.1.100');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('Synology');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

describe('Synology Panel — Connection', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Synology Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should create a Synology connection', async () => {
    await createSynologyConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('Test NAS');
  });

  it('should open Synology panel when connecting', async () => {
    await createSynologyConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.synologyPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should show connection form when not connected', async () => {
    await createSynologyConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.synologyPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });

    const connectionForm = await $(S.synologyConnectionForm);
    expect(await connectionForm.isExisting()).toBe(true);
  });

  it('should have host, username and password fields in connection form', async () => {
    await createSynologyConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.synologyPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });

    const hostField = await $(S.synologyHost);
    const usernameField = await $(S.synologyUsername);
    const passwordField = await $(S.synologyPassword);
    const connectBtn = await $(S.synologyConnectBtn);

    expect(await hostField.isExisting()).toBe(true);
    expect(await usernameField.isExisting()).toBe(true);
    expect(await passwordField.isExisting()).toBe(true);
    expect(await connectBtn.isExisting()).toBe(true);
  });
});

describe('Synology Panel — Tab Navigation', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Synology Tab Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createSynologyConnection();
    const treeEl = await $(S.connectionTree);
    const items = await treeEl.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.synologyPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });
  });

  it('should show Dashboard tab', async () => {
    const dashboardTab = await $(S.synologyDashboardTab);
    expect(await dashboardTab.isExisting()).toBe(true);
  });

  it('should show System tab', async () => {
    const systemTab = await $(S.synologySystemTab);
    expect(await systemTab.isExisting()).toBe(true);
  });

  it('should show Storage tab', async () => {
    const storageTab = await $(S.synologyStorageTab);
    expect(await storageTab.isExisting()).toBe(true);
  });

  it('should show FileStation tab', async () => {
    const fileStationTab = await $(S.synologyFileStationTab);
    expect(await fileStationTab.isExisting()).toBe(true);
  });

  it('should show Packages tab', async () => {
    const packagesTab = await $(S.synologyPackagesTab);
    expect(await packagesTab.isExisting()).toBe(true);
  });

  it('should show Docker tab', async () => {
    const dockerTab = await $(S.synologyDockerTab);
    expect(await dockerTab.isExisting()).toBe(true);
  });

  it('should switch between tabs', async () => {
    const systemTab = await $(S.synologySystemTab);
    await systemTab.click();
    await browser.pause(500);

    // System should be active
    const activeClass = await systemTab.getAttribute('class');
    expect(activeClass).toMatch(/active|selected/);

    const storageTab = await $(S.synologyStorageTab);
    await storageTab.click();
    await browser.pause(500);

    const storageClass = await storageTab.getAttribute('class');
    expect(storageClass).toMatch(/active|selected/);
  });
});
