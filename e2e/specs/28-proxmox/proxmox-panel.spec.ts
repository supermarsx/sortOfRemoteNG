// t67-e8 — Proxmox VE integration panel against the disposable mock PVE server.
//
// Tier: opt-in (see docs/testing/e2e-tier-map.md). Proxmox VE is not
// containerisable, so instead of a Docker service this suite forks the Node
// HTTPS fixture in `e2e/helpers/fixtures/mock-pve/server.mjs`. It needs
// `openssl` on PATH (the fixture generates its own self-signed certificate,
// same constraint as the existing HTTP fixtures) and a built desktop binary
// (`TAURI_BINARY_PATH`), exactly like every other WDIO spec.
//
// Run it with:
//   npx wdio run e2e/wdio.conf.ts --spec e2e/specs/28-proxmox/proxmox-panel.spec.ts
//
// The mock's certificate is freshly generated, so the connection genuinely goes
// through the app's TOFU flow: probe -> show SHA-256 -> accept -> pin -> connect.
// That exercises the crate's fail-closed `insecure + fingerprint` rule rather
// than skipping verification.
import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  closeAllSessions,
} from "../../helpers/app";
import { selectCustomOption } from "../../helpers/forms";
import { startMockPve, type MockPveHandle } from "../../helpers/mock-pve";

let mockPve: MockPveHandle;

async function selectProtocol(protocol: string): Promise<void> {
  const trigger = await $(S.editorProtocol);
  const tagName = await trigger.getTagName();
  if (tagName.toLowerCase() === "select") {
    await trigger.selectByVisibleText(protocol);
    return;
  }
  await selectCustomOption(S.editorProtocol, protocol);
}

async function createProxmoxConnection(name: string): Promise<void> {
  const addBtn = await $(S.toolbarNewConnection);
  await addBtn.click();

  const editor = await $(S.editorPanel);
  await editor.waitForDisplayed({ timeout: 5_000 });

  await (await $(S.editorName)).setValue(name);
  // "Proxmox VE" is the descriptor label (src/components/integrations/proxmox/
  // descriptor.ts); the old spec selected "Proxmox", which never existed.
  await selectProtocol("Proxmox VE");

  const hostname = await $(S.editorHostname);
  if (await hostname.isExisting()) {
    await hostname.clearValue();
    await hostname.setValue(mockPve.host);
  }

  await (await $(S.editorSave)).click();
  await browser.pause(500);
}

async function openConnection(index: number): Promise<void> {
  const tree = await $(S.connectionTree);
  const items = await tree.$$(S.connectionItem);
  await items[index].doubleClick();
}

async function openProxmoxPanel(name: string): Promise<void> {
  await createProxmoxConnection(name);
  await openConnection(0);

  const panel = await $(S.proxmoxPanel);
  await panel.waitForDisplayed({ timeout: 20_000 });
}

/** Fill the panel's connection form with the mock's endpoint + credentials. */
async function fillConnectionForm(password = mockPve.password): Promise<void> {
  const form = await $(S.proxmoxConnectionForm);
  await form.waitForDisplayed({ timeout: 20_000 });

  const host = await $(S.proxmoxHost);
  await host.clearValue();
  await host.setValue(mockPve.host);

  const port = await $(S.proxmoxPort);
  await port.clearValue();
  await port.setValue(String(mockPve.port));

  const username = await $(S.proxmoxUsername);
  await username.clearValue();
  await username.setValue(mockPve.user);

  const passwordField = await $(S.proxmoxPassword);
  await passwordField.clearValue();
  await passwordField.setValue(password);
}

/**
 * Probe the mock's certificate and pin it. Returns the fingerprint the panel
 * showed, so the caller can assert it is the one the server really serves.
 */
async function probeAndPinCertificate(): Promise<string> {
  await (await $(S.proxmoxProbeCertBtn)).click();

  const probeCard = await $(S.proxmoxCertProbe);
  await probeCard.waitForDisplayed({ timeout: 20_000 });
  const shown = await probeCard.getText();

  await (await $(S.proxmoxCertAcceptBtn)).click();

  const fingerprintField = await $(S.proxmoxFingerprint);
  await browser.waitUntil(
    async () => (await fingerprintField.getValue()).trim().length > 0,
    { timeout: 5_000, timeoutMsg: "Expected the probe to fill the pin field" },
  );
  return shown;
}

async function connectAndWaitForSession(): Promise<void> {
  await (await $(S.proxmoxConnectBtn)).click();

  const dashboardTab = await $(S.proxmoxDashboardTab);
  await dashboardTab.waitForDisplayed({ timeout: 30_000 });
}

async function connectToMock(name: string): Promise<void> {
  await openProxmoxPanel(name);
  await fillConnectionForm();
  await probeAndPinCertificate();
  await connectAndWaitForSession();
}

describe("Proxmox VE panel — mock PVE fixture", () => {
  before(async () => {
    mockPve = await startMockPve();
  });

  after(async () => {
    await mockPve?.stop();
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("Proxmox Tests");
    const tree = await $(S.connectionTree);
    await tree.waitForExist({ timeout: 10_000 });
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("creates a Proxmox VE connection and mounts the integration panel", async () => {
    await createProxmoxConnection("PVE Mock");

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    expect(names.join("\n")).toContain("PVE Mock");

    await openConnection(0);

    const integrationPanel = await $(S.proxmoxIntegrationPanel);
    await integrationPanel.waitForDisplayed({ timeout: 20_000 });

    // Mounted from a saved connection => embedded layout, not the legacy modal.
    const embedded = await $(S.proxmoxEmbedded);
    expect(await embedded.isExisting()).toBe(true);

    const hydrationError = await $(S.proxmoxHydrationError);
    expect(await hydrationError.isExisting()).toBe(false);
  });

  it("shows the connection form with realm, auth-mode and TLS controls", async () => {
    await openProxmoxPanel("PVE Mock");

    const form = await $(S.proxmoxConnectionForm);
    await form.waitForDisplayed({ timeout: 20_000 });

    for (const selector of [
      S.proxmoxHost,
      S.proxmoxPort,
      S.proxmoxUsername,
      S.proxmoxPassword,
      S.proxmoxRealm,
      S.proxmoxAuthModePassword,
      S.proxmoxAuthModeApiToken,
      S.proxmoxTlsSkip,
      S.proxmoxFingerprint,
      S.proxmoxProbeCertBtn,
      S.proxmoxConnectBtn,
    ]) {
      expect(await (await $(selector)).isExisting()).toBe(true);
    }
  });

  it("probes the mock certificate and pins the fingerprint the server serves", async () => {
    await openProxmoxPanel("PVE Mock");
    await fillConnectionForm();

    const shown = await probeAndPinCertificate();

    // The TOFU card must show the real fingerprint, not a placeholder.
    expect(shown).toContain(mockPve.fingerprint);
    expect(shown.toLowerCase()).toContain("self-signed");

    const pinned = await (await $(S.proxmoxFingerprint)).getValue();
    expect(pinned.replace(/^SHA256:/iu, "")).toBe(mockPve.fingerprint);

    // Accepting the pin implies "accept self-signed".
    const tlsSkip = await $(S.proxmoxTlsSkip);
    expect(await tlsSkip.isSelected()).toBe(true);
  });

  it("connects and shows the mock node and VM on the dashboard", async () => {
    await connectToMock("PVE Mock");

    const panel = await $(S.proxmoxPanel);
    await browser.waitUntil(
      async () => (await panel.getText()).includes(mockPve.node),
      {
        timeout: 20_000,
        timeoutMsg: `Expected the dashboard to list node ${mockPve.node}`,
      },
    );

    await (await $(S.proxmoxQemuTab)).click();
    await browser.waitUntil(
      async () => {
        const text = await panel.getText();
        return (
          text.includes(mockPve.vmName) && text.includes(String(mockPve.vmid))
        );
      },
      {
        timeout: 20_000,
        timeoutMsg: `Expected the QEMU view to list VM ${mockPve.vmid} ${mockPve.vmName}`,
      },
    );
    expect(await panel.getText()).toContain("running");
  });

  it("refuses a wrong password without opening a session", async () => {
    await openProxmoxPanel("PVE Mock");
    await fillConnectionForm("definitely-not-the-password");
    await probeAndPinCertificate();

    await (await $(S.proxmoxConnectBtn)).click();

    const form = await $(S.proxmoxConnectionForm);
    await browser.waitUntil(
      async () =>
        /invalid credentials|authentication/iu.test(await form.getText()),
      {
        timeout: 20_000,
        timeoutMsg: "Expected an authentication error on the connection form",
      },
    );

    // Still on the form: no dashboard, no session.
    expect(await (await $(S.proxmoxDashboardTab)).isExisting()).toBe(false);
  });

  it("switches between the panel's tabs once connected", async () => {
    await connectToMock("PVE Mock");

    for (const selector of [
      S.proxmoxNodesTab,
      S.proxmoxQemuTab,
      S.proxmoxLxcTab,
      S.proxmoxStorageTab,
      S.proxmoxNetworkTab,
      S.proxmoxTasksTab,
      S.proxmoxSnapshotsTab,
      S.proxmoxConsoleTab,
    ]) {
      expect(await (await $(selector)).isExisting()).toBe(true);
    }

    const nodesTab = await $(S.proxmoxNodesTab);
    await nodesTab.click();
    await browser.pause(300);
    expect(await nodesTab.getAttribute("class")).toMatch(/border-warning/u);

    const qemuTab = await $(S.proxmoxQemuTab);
    await qemuTab.click();
    await browser.pause(300);
    expect(await qemuTab.getAttribute("class")).toMatch(/border-warning/u);
  });

  it("stops and starts the mock VM through the QEMU view", async () => {
    await connectToMock("PVE Mock");

    const panel = await $(S.proxmoxPanel);
    await (await $(S.proxmoxQemuTab)).click();

    const vmRow = await panel.$(`button*=VMID ${mockPve.vmid}`);
    await vmRow.waitForDisplayed({ timeout: 20_000 });
    await vmRow.click();

    // Force stop is confirmed through the shared ConfirmDialog.
    await (await panel.$("button=Stop")).click();
    const confirmYes = await $(S.confirmYes);
    await confirmYes.waitForDisplayed({ timeout: 10_000 });
    await confirmYes.click();

    await browser.waitUntil(
      async () => (await panel.getText()).includes("VMID 100 — stopped"),
      { timeout: 20_000, timeoutMsg: "Expected the VM to report stopped" },
    );

    // The mock is the source of truth for the flip.
    await (await panel.$("button=Start")).click();
    await browser.waitUntil(
      async () => (await panel.getText()).includes("VMID 100 — running"),
      {
        timeout: 20_000,
        timeoutMsg: "Expected the VM to report running again",
      },
    );
  });

  it("refuses a second Proxmox session while one owns the native client", async () => {
    await connectToMock("PVE Mock");
    await createProxmoxConnection("PVE Mock 2");

    const tree = await $(S.connectionTree);
    const items = await tree.$$(S.connectionItem);
    const names = await items.map((item) => item.getText());
    const secondIndex = names.findIndex((name) => name.includes("PVE Mock 2"));
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    await items[secondIndex].doubleClick();

    const refusal = await $("*=uses one process-wide native session at a time");
    await refusal.waitForDisplayed({ timeout: 15_000 });
    expect(await refusal.getText()).toContain("Proxmox VE");
  });

  it("offers the web-UI launch actions from the embedded header", async () => {
    await connectToMock("PVE Mock");

    const header = await $(S.proxmoxEmbeddedHeader);
    await header.waitForDisplayed({ timeout: 10_000 });

    // Password mode => auto-login launch plus the external-browser fallback.
    expect(await (await $(S.proxmoxOpenWebUi)).isExisting()).toBe(true);
    expect(await (await $(S.proxmoxOpenWebUiExternal)).isExisting()).toBe(true);
    expect(await (await $(S.proxmoxHeaderDisconnectBtn)).isExisting()).toBe(
      true,
    );
  });

  it("disconnects and returns to the connection form", async () => {
    await connectToMock("PVE Mock");

    await (await $(S.proxmoxDisconnectBtn)).click();

    const form = await $(S.proxmoxConnectionForm);
    await form.waitForDisplayed({ timeout: 20_000 });
    expect(await (await $(S.proxmoxDashboardTab)).isExisting()).toBe(false);
  });

  // COVERAGE GAP (t67-e8): the xterm console overlay is not asserted here.
  // `S.proxmoxConsoleOverlay` / the console-specific ids are owned by t67-e7
  // (frontend consoles), which has not run — the ids do not exist in `src/`
  // yet, so an assertion on them would be a guaranteed red rather than a test.
  // The mock already serves the whole termproxy path (`POST …/termproxy`, the
  // `vncwebsocket` upgrade, the `user:ticket` handshake, `0:`/`1:`/`2` framing)
  // and `tests/e2e-mock-pve/mock-pve.node-test.mjs` covers it, so wiring the overlay
  // step is a spec-only follow-up once t67-e7 lands. Flagged for t67-g1.
});
