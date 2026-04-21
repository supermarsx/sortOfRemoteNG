import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('WinRM Tools', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('WinRM Test');
  });

  it('should open Windows tool panel for WinRM connection', async () => {
    // Create a WinRM connection
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('Windows Server');
    const hostInput = await $(S.editorHostname);
    await hostInput.setValue('localhost');
    const protoSelect = await $(S.editorProtocol);
    await protoSelect.selectByVisibleText('WinRM');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    // Double-click to open the WinRM tools panel
    const treeItem = await $(S.connectionItem);
    await treeItem.doubleClick();
    await browser.pause(2000);

    const toolPanel = await $('[data-testid="windows-tool-panel"]');
    await toolPanel.waitForExist({ timeout: 10_000 });
    expect(await toolPanel.isDisplayed()).toBe(true);
  });

  it('should show Event Viewer tab', async () => {
    // Create and open WinRM connection
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('EventViewer Host');
    const hostInput = await $(S.editorHostname);
    await hostInput.setValue('localhost');
    const protoSelect = await $(S.editorProtocol);
    await protoSelect.selectByVisibleText('WinRM');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const treeItem = await $(S.connectionItem);
    await treeItem.doubleClick();
    await browser.pause(2000);

    const toolPanel = await $('[data-testid="windows-tool-panel"]');
    await toolPanel.waitForExist({ timeout: 10_000 });

    const eventTab = await $('[data-testid="windows-event-viewer-tab"]');
    await eventTab.waitForExist({ timeout: 5_000 });
    await eventTab.click();
    await browser.pause(1000);

    const eventContent = await $('[data-testid="windows-event-viewer-content"]');
    await eventContent.waitForDisplayed({ timeout: 10_000 });
    expect(await eventContent.isDisplayed()).toBe(true);
  });

  it('should show Services tab', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('Services Host');
    const hostInput = await $(S.editorHostname);
    await hostInput.setValue('localhost');
    const protoSelect = await $(S.editorProtocol);
    await protoSelect.selectByVisibleText('WinRM');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const treeItem = await $(S.connectionItem);
    await treeItem.doubleClick();
    await browser.pause(2000);

    const toolPanel = await $('[data-testid="windows-tool-panel"]');
    await toolPanel.waitForExist({ timeout: 10_000 });

    const servicesTab = await $('[data-testid="windows-services-tab"]');
    await servicesTab.waitForExist({ timeout: 5_000 });
    await servicesTab.click();
    await browser.pause(1000);

    const servicesContent = await $('[data-testid="windows-services-content"]');
    await servicesContent.waitForDisplayed({ timeout: 10_000 });
    expect(await servicesContent.isDisplayed()).toBe(true);
  });

  it('should display WinRM error screen for unreachable host', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed();
    await nameInput.setValue('Bad WinRM');
    const hostInput = await $(S.editorHostname);
    await hostInput.setValue('192.0.2.1');
    const protoSelect = await $(S.editorProtocol);
    await protoSelect.selectByVisibleText('WinRM');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const treeItem = await $(S.connectionItem);
    await treeItem.doubleClick();
    await browser.pause(5000);

    const errorScreen = await $('[data-testid="winrm-error-screen"]');
    await errorScreen.waitForExist({ timeout: 15_000 });
    expect(await errorScreen.isDisplayed()).toBe(true);

    // Should have retry and close buttons
    const retryBtn = await $('[data-testid="winrm-error-retry"]');
    expect(await retryBtn.isExisting()).toBe(true);
    const closeBtn = await $('[data-testid="winrm-error-close"]');
    expect(await closeBtn.isExisting()).toBe(true);
  });
});
