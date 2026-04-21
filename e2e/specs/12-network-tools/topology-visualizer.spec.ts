import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Topology Visualizer', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Topology Tests');
  });

  it('should open topology view', async () => {
    const topoBtn = await $(S.topologyView);
    await topoBtn.click();
    await browser.pause(500);

    const canvas = await $('[data-testid="topology-canvas"]');
    await canvas.waitForDisplayed({ timeout: 5_000 });
    expect(await canvas.isDisplayed()).toBe(true);
  });

  it('should render nodes for connections', async () => {
    // Add connections first
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const nameInput = await $(S.editorName);
    await nameInput.setValue('Topo Node A');
    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('10.0.0.1');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const topoBtn = await $(S.topologyView);
    await topoBtn.click();
    await browser.pause(1_000);

    const nodes = await $$('[data-testid="topology-node"]');
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('should support zoom controls', async () => {
    const topoBtn = await $(S.topologyView);
    await topoBtn.click();
    await browser.pause(500);

    const zoomIn = await $('[data-testid="topology-zoom-in"]');
    expect(await zoomIn.isExisting()).toBe(true);

    const zoomOut = await $('[data-testid="topology-zoom-out"]');
    expect(await zoomOut.isExisting()).toBe(true);

    const zoomReset = await $('[data-testid="topology-zoom-reset"]');
    expect(await zoomReset.isExisting()).toBe(true);

    await zoomIn.click();
    await browser.pause(300);
    await zoomOut.click();
    await browser.pause(300);
  });
});
