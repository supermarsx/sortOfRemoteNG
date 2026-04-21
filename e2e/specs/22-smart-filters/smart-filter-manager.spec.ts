import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

async function addConnection(
  name: string,
  hostname: string,
  protocol: string,
  port?: string,
): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);

  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue(hostname);

  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText(protocol);

  if (port) {
    const portInput = await $(S.editorPort);
    await portInput.clearValue();
    await portInput.setValue(port);
  }

  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);
}

describe('Smart Filter Manager', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Filter Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });

    // Create diverse connections for filtering
    await addConnection('SSH Prod', '10.0.0.1', 'SSH', '22');
    await addConnection('SSH Dev', '10.0.0.2', 'SSH', '2222');
    await addConnection('RDP Server', '10.0.0.3', 'RDP', '3389');
    await addConnection('Web Dashboard', 'https://web.example.com', 'HTTP');
  });

  it('should open smart filter manager', async () => {
    const filterBtn = await $(S.smartFilterBtn);
    await filterBtn.click();
    await browser.pause(300);

    const filterManager = await $(S.smartFilterManager);
    await filterManager.waitForDisplayed({ timeout: 5_000 });
    expect(await filterManager.isDisplayed()).toBe(true);
  });

  it('should add a filter condition by protocol', async () => {
    const filterBtn = await $(S.smartFilterBtn);
    await filterBtn.click();
    await browser.pause(300);

    const addCondition = await $(S.smartFilterAddCondition);
    await addCondition.click();
    await browser.pause(300);

    const fieldSelect = await $(S.smartFilterField);
    await fieldSelect.selectByVisibleText('protocol');

    const operatorSelect = await $(S.smartFilterOperator);
    await operatorSelect.selectByVisibleText('equals');

    const valueInput = await $(S.smartFilterValue);
    await valueInput.setValue('SSH');

    const applyBtn = await $(S.smartFilterApply);
    await applyBtn.click();
    await browser.pause(500);

    // Should show only SSH connections
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names).toContain('SSH Prod');
    expect(names).toContain('SSH Dev');
    expect(names).not.toContain('RDP Server');
  });

  it('should filter by hostname using contains operator', async () => {
    const filterBtn = await $(S.smartFilterBtn);
    await filterBtn.click();
    await browser.pause(300);

    const addCondition = await $(S.smartFilterAddCondition);
    await addCondition.click();
    await browser.pause(300);

    const fieldSelect = await $(S.smartFilterField);
    await fieldSelect.selectByVisibleText('hostname');

    const operatorSelect = await $(S.smartFilterOperator);
    await operatorSelect.selectByVisibleText('contains');

    const valueInput = await $(S.smartFilterValue);
    await valueInput.setValue('10.0.0');

    const applyBtn = await $(S.smartFilterApply);
    await applyBtn.click();
    await browser.pause(500);

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    expect(items.length).toBe(3); // SSH Prod, SSH Dev, RDP Server
  });

  it('should combine multiple conditions with AND logic', async () => {
    const filterBtn = await $(S.smartFilterBtn);
    await filterBtn.click();
    await browser.pause(300);

    // First condition: protocol = SSH
    const addCondition = await $(S.smartFilterAddCondition);
    await addCondition.click();
    await browser.pause(300);

    const fieldSelect = await $(S.smartFilterField);
    await fieldSelect.selectByVisibleText('protocol');

    const operatorSelect = await $(S.smartFilterOperator);
    await operatorSelect.selectByVisibleText('equals');

    const valueInput = await $(S.smartFilterValue);
    await valueInput.setValue('SSH');

    // Second condition: name contains "Prod"
    await addCondition.click();
    await browser.pause(300);

    const fields = await $$(`${S.smartFilterField}`);
    await fields[1].selectByVisibleText('name');

    const operators = await $$(`${S.smartFilterOperator}`);
    await operators[1].selectByVisibleText('contains');

    const values = await $$(`${S.smartFilterValue}`);
    await values[1].setValue('Prod');

    const applyBtn = await $(S.smartFilterApply);
    await applyBtn.click();
    await browser.pause(500);

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    expect(items.length).toBe(1); // Only "SSH Prod"
  });

  it('should toggle between AND/OR logic', async () => {
    const filterBtn = await $(S.smartFilterBtn);
    await filterBtn.click();
    await browser.pause(300);

    const logicToggle = await $(S.smartFilterLogicToggle);
    const initialText = await logicToggle.getText();

    await logicToggle.click();
    await browser.pause(300);

    const newText = await logicToggle.getText();
    expect(newText).not.toBe(initialText);
  });

  it('should clear all filter conditions', async () => {
    const filterBtn = await $(S.smartFilterBtn);
    await filterBtn.click();
    await browser.pause(300);

    const addCondition = await $(S.smartFilterAddCondition);
    await addCondition.click();
    await browser.pause(300);

    const fieldSelect = await $(S.smartFilterField);
    await fieldSelect.selectByVisibleText('protocol');

    const operatorSelect = await $(S.smartFilterOperator);
    await operatorSelect.selectByVisibleText('equals');

    const valueInput = await $(S.smartFilterValue);
    await valueInput.setValue('SSH');

    const applyBtn = await $(S.smartFilterApply);
    await applyBtn.click();
    await browser.pause(500);

    const clearBtn = await $(S.smartFilterClear);
    await clearBtn.click();
    await browser.pause(500);

    // All connections should be visible again
    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    expect(items.length).toBe(4);
  });

  it('should show filter preview count', async () => {
    const filterBtn = await $(S.smartFilterBtn);
    await filterBtn.click();
    await browser.pause(300);

    const addCondition = await $(S.smartFilterAddCondition);
    await addCondition.click();
    await browser.pause(300);

    const fieldSelect = await $(S.smartFilterField);
    await fieldSelect.selectByVisibleText('protocol');

    const operatorSelect = await $(S.smartFilterOperator);
    await operatorSelect.selectByVisibleText('equals');

    const valueInput = await $(S.smartFilterValue);
    await valueInput.setValue('SSH');
    await browser.pause(500);

    const preview = await $(S.smartFilterPreview);
    const previewText = await preview.getText();
    expect(previewText).toContain('2');
  });

  it('should support regex matching', async () => {
    const filterBtn = await $(S.smartFilterBtn);
    await filterBtn.click();
    await browser.pause(300);

    const addCondition = await $(S.smartFilterAddCondition);
    await addCondition.click();
    await browser.pause(300);

    const fieldSelect = await $(S.smartFilterField);
    await fieldSelect.selectByVisibleText('name');

    const operatorSelect = await $(S.smartFilterOperator);
    await operatorSelect.selectByVisibleText('regex_match');

    const valueInput = await $(S.smartFilterValue);
    await valueInput.setValue('SSH.*');

    const applyBtn = await $(S.smartFilterApply);
    await applyBtn.click();
    await browser.pause(500);

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    expect(items.length).toBe(2);
  });

  it('should remove a single condition', async () => {
    const filterBtn = await $(S.smartFilterBtn);
    await filterBtn.click();
    await browser.pause(300);

    const addCondition = await $(S.smartFilterAddCondition);
    await addCondition.click();
    await browser.pause(300);

    // Add a second condition
    await addCondition.click();
    await browser.pause(300);

    const removeButtons = await $$(S.smartFilterRemoveCondition);
    expect(removeButtons.length).toBe(2);

    await removeButtons[0].click();
    await browser.pause(300);

    const remainingRemoveButtons = await $$(S.smartFilterRemoveCondition);
    expect(remainingRemoveButtons.length).toBe(1);
  });
});
