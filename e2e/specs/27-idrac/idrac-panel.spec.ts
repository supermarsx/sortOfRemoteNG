import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

async function createIdracConnection(): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue('Dell Server R740');

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('10.0.0.50');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('iDRAC');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

describe('iDRAC Panel — Connection', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('iDRAC Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should create an iDRAC connection', async () => {
    await createIdracConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('Dell Server R740');
  });

  it('should open iDRAC panel when connecting', async () => {
    await createIdracConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.idracPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should show connection form with credentials', async () => {
    await createIdracConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.idracPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });

    const hostField = await $(S.idracHost);
    const usernameField = await $(S.idracUsername);
    const passwordField = await $(S.idracPassword);
    const connectBtn = await $(S.idracConnectBtn);

    expect(await hostField.isExisting()).toBe(true);
    expect(await usernameField.isExisting()).toBe(true);
    expect(await passwordField.isExisting()).toBe(true);
    expect(await connectBtn.isExisting()).toBe(true);
  });
});

describe('iDRAC Panel — Tab Navigation', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('iDRAC Tab Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createIdracConnection();
    const treeEl = await $(S.connectionTree);
    const items = await treeEl.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.idracPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });
  });

  it('should show Dashboard tab', async () => {
    const dashboardTab = await $(S.idracDashboardTab);
    expect(await dashboardTab.isExisting()).toBe(true);
  });

  it('should show Power tab', async () => {
    const powerTab = await $(S.idracPowerTab);
    expect(await powerTab.isExisting()).toBe(true);
  });

  it('should show Thermal tab', async () => {
    const thermalTab = await $(S.idracThermalTab);
    expect(await thermalTab.isExisting()).toBe(true);
  });

  it('should show Hardware tab', async () => {
    const hardwareTab = await $(S.idracHardwareTab);
    expect(await hardwareTab.isExisting()).toBe(true);
  });

  it('should show Storage tab', async () => {
    const storageTab = await $(S.idracStorageTab);
    expect(await storageTab.isExisting()).toBe(true);
  });

  it('should show Network tab', async () => {
    const networkTab = await $(S.idracNetworkTab);
    expect(await networkTab.isExisting()).toBe(true);
  });

  it('should show Firmware tab', async () => {
    const firmwareTab = await $(S.idracFirmwareTab);
    expect(await firmwareTab.isExisting()).toBe(true);
  });

  it('should switch between tabs', async () => {
    const powerTab = await $(S.idracPowerTab);
    await powerTab.click();
    await browser.pause(500);

    const powerClass = await powerTab.getAttribute('class');
    expect(powerClass).toMatch(/active|selected/);

    const thermalTab = await $(S.idracThermalTab);
    await thermalTab.click();
    await browser.pause(500);

    const thermalClass = await thermalTab.getAttribute('class');
    expect(thermalClass).toMatch(/active|selected/);
  });
});

describe('iDRAC Panel — Power Management', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('iDRAC Power Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createIdracConnection();
    const treeEl = await $(S.connectionTree);
    const items = await treeEl.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.idracPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });
  });

  it('should show power control buttons', async () => {
    const powerTab = await $(S.idracPowerTab);
    await powerTab.click();
    await browser.pause(500);

    const powerOn = await $(S.idracPowerOn);
    const powerOff = await $(S.idracPowerOff);
    const powerReset = await $(S.idracPowerReset);

    expect(await powerOn.isExisting()).toBe(true);
    expect(await powerOff.isExisting()).toBe(true);
    expect(await powerReset.isExisting()).toBe(true);
  });

  it('should require confirmation for power off', async () => {
    const powerTab = await $(S.idracPowerTab);
    await powerTab.click();
    await browser.pause(500);

    const powerOff = await $(S.idracPowerOff);
    await powerOff.click();
    await browser.pause(500);

    const confirmDialog = await $(S.confirmDialog);
    expect(await confirmDialog.isDisplayed()).toBe(true);

    // Cancel the operation
    const cancelBtn = await $(S.confirmNo);
    await cancelBtn.click();
    await browser.pause(300);
  });

  it('should require confirmation for power reset', async () => {
    const powerTab = await $(S.idracPowerTab);
    await powerTab.click();
    await browser.pause(500);

    const powerReset = await $(S.idracPowerReset);
    await powerReset.click();
    await browser.pause(500);

    const confirmDialog = await $(S.confirmDialog);
    expect(await confirmDialog.isDisplayed()).toBe(true);

    const cancelBtn = await $(S.confirmNo);
    await cancelBtn.click();
    await browser.pause(300);
  });
});
