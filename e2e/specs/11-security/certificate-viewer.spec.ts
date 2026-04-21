import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Certificate Viewer', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Certificate Tests');
  });

  it('should view certificate chain for HTTPS connection', async () => {
    // Create an HTTPS connection
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const nameInput = await $(S.editorName);
    await nameInput.setValue('HTTPS Site');
    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('example.com');
    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('HTTPS');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    // Open certificate viewer
    const certBtn = await $('[data-testid="view-certificate"]');
    await certBtn.click();
    await browser.pause(500);

    const certViewer = await $('[data-testid="certificate-viewer"]');
    await certViewer.waitForDisplayed({ timeout: 5_000 });

    const certChain = await $$('[data-testid="certificate-chain-item"]');
    expect(certChain.length).toBeGreaterThanOrEqual(1);
  });

  it('should display certificate details including issuer and expiry', async () => {
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    const editor = await $(S.editorPanel);
    await editor.waitForDisplayed({ timeout: 5_000 });
    const nameInput = await $(S.editorName);
    await nameInput.setValue('Cert Detail Host');
    const hostnameInput = await $(S.editorHostname);
    await hostnameInput.setValue('example.com');
    const protocolSelect = await $(S.editorProtocol);
    await protocolSelect.selectByVisibleText('HTTPS');
    const saveBtn = await $(S.editorSave);
    await saveBtn.click();
    await browser.pause(500);

    const certBtn = await $('[data-testid="view-certificate"]');
    await certBtn.click();
    await browser.pause(500);

    const certViewer = await $('[data-testid="certificate-viewer"]');
    await certViewer.waitForDisplayed({ timeout: 5_000 });

    const issuer = await $('[data-testid="cert-issuer"]');
    expect(await issuer.getText()).toBeTruthy();

    const expiry = await $('[data-testid="cert-expiry"]');
    expect(await expiry.getText()).toBeTruthy();
  });
});
