import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

async function createProxmoxConnection(): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue('PVE Cluster');

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('10.0.0.100');

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('Proxmox');

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

describe('Proxmox Panel — Connection', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Proxmox Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should create a Proxmox connection', async () => {
    await createProxmoxConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('PVE Cluster');
  });

  it('should open Proxmox panel when connecting', async () => {
    await createProxmoxConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.proxmoxPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should show connection form fields', async () => {
    await createProxmoxConnection();

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.proxmoxPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });

    const hostField = await $(S.proxmoxHost);
    const usernameField = await $(S.proxmoxUsername);
    const passwordField = await $(S.proxmoxPassword);
    const connectBtn = await $(S.proxmoxConnectBtn);

    expect(await hostField.isExisting()).toBe(true);
    expect(await usernameField.isExisting()).toBe(true);
    expect(await passwordField.isExisting()).toBe(true);
    expect(await connectBtn.isExisting()).toBe(true);
  });
});

describe('Proxmox Panel — Tab Navigation', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Proxmox Tab Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    await createProxmoxConnection();
    const treeEl = await $(S.connectionTree);
    const items = await treeEl.$$(S.connectionItem);
    await items[0].doubleClick();
    await browser.pause(1000);

    const panel = await $(S.proxmoxPanel);
    await panel.waitForDisplayed({ timeout: 10_000 });
  });

  it('should show Dashboard tab', async () => {
    const dashboardTab = await $(S.proxmoxDashboardTab);
    expect(await dashboardTab.isExisting()).toBe(true);
  });

  it('should show Nodes tab', async () => {
    const nodesTab = await $(S.proxmoxNodesTab);
    expect(await nodesTab.isExisting()).toBe(true);
  });

  it('should show QEMU (VMs) tab', async () => {
    const qemuTab = await $(S.proxmoxQemuTab);
    expect(await qemuTab.isExisting()).toBe(true);
  });

  it('should show LXC (Containers) tab', async () => {
    const lxcTab = await $(S.proxmoxLxcTab);
    expect(await lxcTab.isExisting()).toBe(true);
  });

  it('should show Storage tab', async () => {
    const storageTab = await $(S.proxmoxStorageTab);
    expect(await storageTab.isExisting()).toBe(true);
  });

  it('should show Network tab', async () => {
    const networkTab = await $(S.proxmoxNetworkTab);
    expect(await networkTab.isExisting()).toBe(true);
  });

  it('should show Tasks tab', async () => {
    const tasksTab = await $(S.proxmoxTasksTab);
    expect(await tasksTab.isExisting()).toBe(true);
  });

  it('should show Snapshots tab', async () => {
    const snapshotsTab = await $(S.proxmoxSnapshotsTab);
    expect(await snapshotsTab.isExisting()).toBe(true);
  });

  it('should switch between tabs', async () => {
    const nodesTab = await $(S.proxmoxNodesTab);
    await nodesTab.click();
    await browser.pause(500);

    const nodesClass = await nodesTab.getAttribute('class');
    expect(nodesClass).toMatch(/active|selected/);

    const qemuTab = await $(S.proxmoxQemuTab);
    await qemuTab.click();
    await browser.pause(500);

    const qemuClass = await qemuTab.getAttribute('class');
    expect(qemuClass).toMatch(/active|selected/);
  });
});
