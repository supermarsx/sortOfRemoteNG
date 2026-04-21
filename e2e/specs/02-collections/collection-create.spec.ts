import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Collection Creation', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  it('should show collection selector on first launch', async () => {
    // After reset, the app should prompt for a collection
    const selector = await $(S.collectionSelector);
    await selector.waitForExist({ timeout: 10000 });
    expect(await selector.isDisplayed()).toBe(true);
  });

  it('should create an unencrypted collection', async () => {
    await createCollection('Test Collection');
    
    // After collection creation, the connection area should be available
    const connectionTree = await $(S.connectionTree);
    await connectionTree.waitForExist({ timeout: 10000 });
    expect(await connectionTree.isDisplayed()).toBe(true);
  });

  it('should create an encrypted collection with password', async () => {
    await createCollection('Secure Collection', true, 'StrongPass123!');
    
    // Should still show the connection tree after creation
    const connectionTree = await $(S.connectionTree);
    await connectionTree.waitForExist({ timeout: 10000 });
    expect(await connectionTree.isDisplayed()).toBe(true);
  });

  it('should show empty state in new collection', async () => {
    await createCollection('Empty Collection');
    
    // Welcome screen or empty state should be shown
    const welcome = await $(S.welcomeScreen);
    expect(await welcome.isExisting()).toBe(true);
  });
});
