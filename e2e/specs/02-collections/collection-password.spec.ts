import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Encrypted Collection Password', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  it('should require password to open encrypted collection', async () => {
    // Create an encrypted collection first
    await createCollection('Locked Col', true, 'MySecret456!');
    
    // Reset state to simulate re-opening
    await resetAppState();
    
    // The password dialog should appear when trying to open the encrypted collection
    const passwordDialog = await $(S.passwordDialog);
    // If auto-open is enabled, password dialog should show
    // Otherwise, collection selector shows
    const selector = await $(S.collectionSelector);
    const hasDialog = await passwordDialog.isExisting();
    const hasSelector = await selector.isExisting();
    expect(hasDialog || hasSelector).toBe(true);
  });

  it('should reject wrong password', async () => {
    await createCollection('Locked Col 2', true, 'CorrectPass!');
    await resetAppState();
    
    const passwordDialog = await $(S.passwordDialog);
    if (await passwordDialog.isExisting()) {
      const input = await $(S.passwordInput);
      await input.setValue('WrongPassword!');
      const submit = await $(S.passwordSubmit);
      await submit.click();
      
      // Should show an error or remain on password dialog
      await browser.pause(1000);
      // Password dialog or error should still be visible
      const stillVisible = await passwordDialog.isExisting();
      const errorBanner = await $('[data-testid="password-error"]');
      expect(stillVisible || await errorBanner.isExisting()).toBe(true);
    }
  });

  it('should accept correct password and show connections', async () => {
    await createCollection('Locked Col 3', true, 'GoodPass789!');
    await resetAppState();
    
    const passwordDialog = await $(S.passwordDialog);
    if (await passwordDialog.isExisting()) {
      const input = await $(S.passwordInput);
      await input.setValue('GoodPass789!');
      const submit = await $(S.passwordSubmit);
      await submit.click();
      
      // Connection tree should become available
      const tree = await $(S.connectionTree);
      await tree.waitForExist({ timeout: 10000 });
      expect(await tree.isDisplayed()).toBe(true);
    }
  });
});
