import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('TOTP Manager', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('TOTP Tests');
  });

  it('should add a TOTP secret', async () => {
    const totpBtn = await $('[data-testid="open-totp-manager"]');
    await totpBtn.click();
    await browser.pause(500);

    const addSecretBtn = await $('[data-testid="totp-add-secret"]');
    await addSecretBtn.click();

    const secretInput = await $('[data-testid="totp-secret-input"]');
    await secretInput.setValue('JBSWY3DPEHPK3PXP');

    const labelInput = await $('[data-testid="totp-label-input"]');
    await labelInput.setValue('Test Server TOTP');

    const saveBtn = await $('[data-testid="totp-save"]');
    await saveBtn.click();
    await browser.pause(500);

    const items = await $$('[data-testid="totp-item"]');
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('should render QR code for TOTP secret', async () => {
    const totpBtn = await $('[data-testid="open-totp-manager"]');
    await totpBtn.click();
    await browser.pause(500);

    const addSecretBtn = await $('[data-testid="totp-add-secret"]');
    await addSecretBtn.click();

    const secretInput = await $('[data-testid="totp-secret-input"]');
    await secretInput.setValue('JBSWY3DPEHPK3PXP');

    const labelInput = await $('[data-testid="totp-label-input"]');
    await labelInput.setValue('QR Test');

    const saveBtn = await $('[data-testid="totp-save"]');
    await saveBtn.click();
    await browser.pause(500);

    const qrCode = await $('[data-testid="totp-qr-code"]');
    expect(await qrCode.isExisting()).toBe(true);
  });

  it('should import TOTP configuration', async () => {
    const totpBtn = await $('[data-testid="open-totp-manager"]');
    await totpBtn.click();
    await browser.pause(500);

    const importBtn = await $('[data-testid="totp-import"]');
    await importBtn.click();
    await browser.pause(500);

    const importDialog = await $('[data-testid="totp-import-dialog"]');
    expect(await importDialog.isDisplayed()).toBe(true);
  });
});
