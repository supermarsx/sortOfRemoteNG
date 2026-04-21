import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Smart Filter Presets', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Preset Tests');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  it('should save a filter as a preset', async () => {
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

    // Save as preset
    const savePresetBtn = await $(S.smartFilterSavePreset);
    await savePresetBtn.click();
    await browser.pause(300);

    const presetNameInput = await $(S.smartFilterPresetName);
    await presetNameInput.setValue('SSH Only');

    const confirmBtn = await $(S.smartFilterPresetConfirm);
    await confirmBtn.click();
    await browser.pause(500);

    // Verify preset appears in list
    const presetsBtn = await $(S.smartFilterPresets);
    await presetsBtn.click();
    await browser.pause(300);

    const presetItems = await $$('[data-testid="smart-filter-preset-item"]');
    const presetNames = await presetItems.map((item) => item.getText());
    expect(presetNames).toContain('SSH Only');
  });

  it('should load a saved preset', async () => {
    // First save a preset
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
    await valueInput.setValue('RDP');

    const savePresetBtn = await $(S.smartFilterSavePreset);
    await savePresetBtn.click();
    await browser.pause(300);

    const presetNameInput = await $(S.smartFilterPresetName);
    await presetNameInput.setValue('RDP Only');

    const confirmBtn = await $(S.smartFilterPresetConfirm);
    await confirmBtn.click();
    await browser.pause(500);

    // Clear filter
    const clearBtn = await $(S.smartFilterClear);
    await clearBtn.click();
    await browser.pause(300);

    // Load preset
    const presetsBtn = await $(S.smartFilterPresets);
    await presetsBtn.click();
    await browser.pause(300);

    const presetItems = await $$('[data-testid="smart-filter-preset-item"]');
    for (const item of presetItems) {
      const text = await item.getText();
      if (text.includes('RDP Only')) {
        await item.click();
        break;
      }
    }
    await browser.pause(500);

    // Verify filter is applied
    const appliedField = await $(S.smartFilterField);
    const selectedText = await appliedField.getValue();
    expect(selectedText).toContain('protocol');
  });
});
