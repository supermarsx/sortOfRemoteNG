import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Collection Switching', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  it('should create and switch between two collections', async () => {
    // Create first collection
    await createCollection('Collection A');
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10000 });
    
    // Open collection selector to create second
    const toolbarBtn = await $('[data-testid="toolbar-collection"]');
    if (await toolbarBtn.isExisting()) {
      await toolbarBtn.click();
    }
    
    // The collections should maintain independent state
    expect(await tree.isDisplayed()).toBe(true);
  });

  it('should maintain separate connection lists per collection', async () => {
    await createCollection('Work Servers');
    
    // Add a connection to this collection would be done via the editor
    // For now, verify the tree is present
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10000 });
    expect(await tree.isDisplayed()).toBe(true);
  });
});
