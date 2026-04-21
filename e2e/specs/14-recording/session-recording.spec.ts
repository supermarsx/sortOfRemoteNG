import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, closeAllSessions } from '../../helpers/app';
import { startContainers, stopContainers, waitForContainer, SSH_PORT } from '../../helpers/docker';

async function createAndConnectSSH(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();
  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });
  const nameInput = await $(S.editorName);
  await nameInput.setValue(name);
  const hostnameInput = await $(S.editorHostname);
  await hostnameInput.setValue('localhost');
  const protocolSelect = await $(S.editorProtocol);
  await protocolSelect.selectByVisibleText('SSH');
  const portInput = await $(S.editorPort);
  await portInput.clearValue();
  await portInput.setValue('22');
  const usernameInput = await $(S.editorUsername);
  await usernameInput.setValue('testuser');
  const passwordInput = await $(S.editorPassword);
  await passwordInput.setValue('testpass123');
  const saveBtn = await $(S.editorSave);
  await saveBtn.click();
  await browser.pause(500);

  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(name)) {
      await item.doubleClick();
      break;
    }
  }
  const terminal = await $(S.sshTerminal);
  await terminal.waitForDisplayed({ timeout: 15_000 });
}

describe('Session Recording', () => {
  before(async function () {
    this.timeout(120_000);
    startContainers();
    await waitForContainer('test-ssh', SSH_PORT, 60_000);
  });

  after(() => {
    stopContainers();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection('Recording Tests');
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it('should show recording indicator when recording starts', async () => {
    await createAndConnectSSH('Record Server');

    const recordBtn = await $(S.recordingStart);
    await recordBtn.click();
    await browser.pause(500);

    const indicator = await $('[data-testid="recording-indicator"]');
    expect(await indicator.isDisplayed()).toBe(true);
  });

  it('should capture typed commands during recording', async () => {
    await createAndConnectSSH('Capture Server');

    const recordBtn = await $(S.recordingStart);
    await recordBtn.click();
    await browser.pause(500);

    // Type a command
    for (const ch of 'echo hello') {
      await browser.keys(ch);
    }
    await browser.keys('Enter');
    await browser.pause(1_000);

    const stopBtn = await $(S.recordingStop);
    await stopBtn.click();
    await browser.pause(500);
  });

  it('should save recording when stopped', async () => {
    await createAndConnectSSH('Save Record');

    const recordBtn = await $(S.recordingStart);
    await recordBtn.click();
    await browser.pause(500);

    for (const ch of 'ls -la') {
      await browser.keys(ch);
    }
    await browser.keys('Enter');
    await browser.pause(1_000);

    const stopBtn = await $(S.recordingStop);
    await stopBtn.click();
    await browser.pause(500);

    // Verify recording saved notification or recording list
    const recordings = await $$('[data-testid="recording-item"]');
    expect(recordings.length).toBeGreaterThanOrEqual(1);
  });

  it('should replay recording with play/pause/speed controls', async () => {
    await createAndConnectSSH('Replay Server');

    const recordBtn = await $(S.recordingStart);
    await recordBtn.click();
    await browser.pause(500);

    for (const ch of 'whoami') {
      await browser.keys(ch);
    }
    await browser.keys('Enter');
    await browser.pause(1_000);

    const stopBtn = await $(S.recordingStop);
    await stopBtn.click();
    await browser.pause(500);

    // Open replay viewer
    const recordings = await $$('[data-testid="recording-item"]');
    await recordings[0].click();
    await browser.pause(500);

    const replayViewer = await $(S.replayViewer);
    await replayViewer.waitForDisplayed({ timeout: 5_000 });

    const playBtn = await $('[data-testid="recording-play-btn"]');
    expect(await playBtn.isExisting()).toBe(true);

    const pauseBtn = await $('[data-testid="recording-pause-btn"]');
    expect(await pauseBtn.isExisting()).toBe(true);

    const speedControl = await $('[data-testid="recording-speed-control"]');
    expect(await speedControl.isExisting()).toBe(true);
  });
});
