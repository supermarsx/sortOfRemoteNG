// t84-e8 — Synology NAS API permissions and 2FA against the mock DSM fixture.
//
// Tier: opt-in (see docs/testing/e2e-tier-map.md). Real DSM and Virtual DSM
// are off limits (licence), so this suite forks the synthetic Node HTTP
// fixture in `e2e/helpers/fixtures/mock-dsm/server.mjs` (lifecycle in
// `e2e/helpers/mock-dsm.ts`). The fixture itself is covered without the
// desktop binary by `node --test tests/e2e-mock-dsm/*.node-test.mjs`.
//
// Run it with a fresh `cargo tauri build --debug` binary (TAURI_BINARY_PATH):
//   npx wdio run e2e/wdio.conf.ts --spec e2e/specs/26-synology/nas-api-permissions.spec.ts
//
// Every scenario saves an HTTP connection → Application "Synology DSM" →
// "Synology NAS API" over plain HTTP to 127.0.0.1:18501, opens it (the session
// signs in once automatically) and checks what the panel shows plus what the
// fixture recorded. Coverage limits, by design:
//   - The fixture has no Noise-IK responder, so the complete DSM 7 secure
//     handshake (`Login handshake: DSM 7 secure (IK)`, `X-SYNO-HASH`, CPU data
//     for `remote-admin`) is covered by t84-e2's Rust tests only. Here the
//     legacy and `ik_incomplete` fallbacks are exercised end to end.
//   - Trusted-device (device token) reuse needs a vault-backed connection and
//     `e2e/helpers` has no vault-credential setup helper, so it is not
//     e2e-covered; the fixture's did issue/reuse is node-tested and the app
//     side is unit-covered (plan t84 §7.10, e11 + e10 suites). For the same
//     reason automatic codes are e2e-covered for connection-local
//     authenticators only (t93); the vault authenticator path is unit-covered.
//   - Automatic one-time codes (t93) use the `otp-seed` account, which checks
//     real RFC 6238 codes over the fixture's synthetic seed; the spec computes
//     valid codes in Node with `mockDsmTotpCode`.
//
// Response shapes: the fixture serves DSM's real shapes by default (t84-r1
// audit, `.orchestration/scratch/t84/dsm-response-shapes.md` §6). The
// administrator scenario reads Utilization, Core.User and Core.Group, so it
// fails with `json_schema` against the pre-t84 decoders and passes once the
// t84 Rust decoder fix lands. `MOCK_DSM_WIRE=legacy` serves the old decoder
// shapes; run the spec in both modes to prove the fixed decoders take both.
//
// Selectors are confirmed against the finished frontend work: the sidebar,
// needs-access group and session identity panel (t84-e3, `Sidebar.tsx`,
// `SynologyAccountAccess.tsx`), the restricted-view notices (t84-e5) and the
// 2FA dialog (t84-e6/e10, `ConnectionForm.tsx` + `Modal.tsx`).
import { S } from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  closeAllSessions,
} from "../../helpers/app";
import { selectCustomOption } from "../../helpers/forms";
import {
  startMockDsm,
  mockDsmTotpCode,
  MOCK_DSM_PORT,
  type MockDsmAccountName,
  type MockDsmCall,
  type MockDsmHandle,
  type MockDsmLogin,
} from "../../helpers/mock-dsm";

const SEL = {
  editorProtocolTab: '[data-testid="connection-editor-tab-protocol"]',
  applicationSubtab:
    '[data-testid="connection-editor-protocol-subtab-application"]',
  applicationProfile: "#http-application-profile",
  synologyAccessMode: '[aria-label="Synology access mode"]',
  synologyTransport: '[aria-label="Synology transport"]',
  dsmUsername: 'input[aria-label="DSM API username"]',
  dsmPassword: 'input[aria-label="DSM API password"]',
  panel: S.synologyPanel,
  systemTab: '[data-testid="synology-tab-system"]',
  refresh: './/button[normalize-space(.)="Refresh"]',
  // Every sidebar tab button carries `data-access-status` (e3).
  checkingSection: '[data-access-status="checking"]',
  // Collapsed `<details>` "Needs more access (n)"; its tab buttons keep the
  // `synology-tab-<key>` ids (e3).
  needsAccessGroup: '[data-testid="synology-sections-needs-access"]',
  usersTab: '[data-testid="synology-tab-users"]',
  // Session identity panel, `data-tone="warning"|"neutral"` (e3).
  accountAccess: '[data-testid="synology-account-access"]',
  accountIdentity: '[data-testid="synology-account-identity"]',
  // Rendered only when the panel's tone is warning (e3).
  reconnect: '[data-testid="synology-reconnect"]',
  reconnectDsmSession: '[data-testid="synology-reconnect-dsm-session"]',
  // Per-table notices (t84-e5, done): one per table the read feeds, so the
  // System tab shows four `utilization` notices (CPU, Memory, Network, Disk).
  readRestriction: '[data-testid="synology-read-restriction"]',
  utilizationRestriction:
    '[data-testid="synology-read-restriction"][data-read-field="utilization"]',
  restrictionTitle: '[data-testid="synology-read-restriction-title"]',
  restrictionReason: '[data-testid="synology-read-restriction-reason"]',
  restrictionReconnect: '[data-testid="synology-read-restriction-reconnect"]',
  restrictionReconnectDsmSession:
    '[data-testid="synology-read-restriction-reconnect-dsm-session"]',
  // AdminTable keeps its <section><h3>title</h3> with or without a notice (e5).
  cpuTable:
    '(//section[.//h3[starts-with(normalize-space(.), "CPU")]])[last()]',
  usersTable:
    '(//section[.//h3[normalize-space(.)="Users" or starts-with(normalize-space(.), "Users (")]])[last()]',
  groupsTable:
    '(//section[.//h3[normalize-space(.)="Groups" or starts-with(normalize-space(.), "Groups (")]])[last()]',
  // The challenge `Modal` (`role="dialog"` + `aria-label`); the code field and
  // Verify button render only for otp_required/otp_invalid (e6).
  twoFactorDialog:
    '[role="dialog"][aria-label="Synology two-factor authentication"]',
  otpInput: 'input[autocomplete="one-time-code"]',
  verifyCode: './/button[normalize-space(.)="Verify code"]',
  // t93-e1: why the dialog opened after an automatic code (role="status").
  automaticCodeNotice: '[data-testid="synology-automatic-code-notice"]',
  // t93-e2: NAS API authenticator section in Synology access settings. The
  // select and secret field are matched by the `aria-label` the shared `Select`
  // and `PasswordInput` render on their control.
  authenticatorSection: '[data-testid="synology-authenticator-section"]',
  authenticatorSelect: '[aria-label="NAS API authenticator"]',
  authenticatorSecret: 'input[aria-label="Authenticator secret"]',
  saveAuthenticator: './/button[normalize-space(.)="Save authenticator"]',
  checkCode: './/button[normalize-space(.)="Check code"]',
  authenticatorCode: '[data-testid="synology-authenticator-code"]',
} as const;

/** DSM's authenticator period; the fixture's `otp-seed` uses the same. */
const TOTP_PERIOD_MS = 30_000;
const totpStep = (atMs: number) => Math.floor(atMs / TOTP_PERIOD_MS);

let mockDsm: MockDsmHandle;

/** `textContent`, not `getText()`: collapsed `<details>` and narrow-width panels hide text. */
async function textContent(element: {
  getProperty: (property: string) => Promise<unknown>;
}) {
  return String((await element.getProperty("textContent")) ?? "");
}

async function setInput(selector: string, value: string): Promise<void> {
  const input = await $(selector);
  await input.waitForDisplayed({ timeout: 10_000 });
  await input.clearValue();
  await input.setValue(value);
}

/**
 * Save a Synology NAS API connection for one fixture account through the real
 * connection editor: HTTP → Application "Synology DSM" → "Synology NAS API",
 * HTTP transport, saved DSM username/password. `configureAccess` runs on the
 * same Synology access settings before the connection is saved.
 */
async function createNasApiConnection(
  name: string,
  accountName: MockDsmAccountName,
  target: MockDsmHandle = mockDsm,
  configureAccess?: () => Promise<void>,
): Promise<void> {
  const account = target.accounts[accountName];
  await (await $(S.toolbarNewConnection)).click();
  await (await $(S.editorPanel)).waitForDisplayed({ timeout: 10_000 });

  await setInput(S.editorName, name);
  await setInput(S.editorHostname, target.host);
  await selectCustomOption(S.editorProtocol, "HTTP");
  await setInput(S.editorPort, String(target.port));

  await (await $(SEL.editorProtocolTab)).click();
  const applicationSubtab = await $(SEL.applicationSubtab);
  await applicationSubtab.waitForDisplayed({ timeout: 10_000 });
  await applicationSubtab.click();

  await selectCustomOption(SEL.applicationProfile, "Synology DSM");
  await selectCustomOption(SEL.synologyAccessMode, "Synology NAS API");
  const transport = await $(SEL.synologyTransport);
  await transport.waitForDisplayed({ timeout: 10_000 });
  if (!(await transport.getText()).includes("HTTP — unencrypted")) {
    await selectCustomOption(
      SEL.synologyTransport,
      "HTTP — unencrypted (trusted networks only)",
    );
  }
  await setInput(SEL.dsmUsername, account.username);
  await setInput(SEL.dsmPassword, account.password);
  await configureAccess?.();

  // Transport changes only reset the DSM default ports; the fixture port stays.
  await (
    await $('[data-testid="connection-editor-tab-general"]')
  )
    .click()
    .catch(() => undefined);
  const port = await $(S.editorPort);
  if (await port.isExisting()) {
    expect((await port.getValue()).replace(/\D/gu, "")).toBe(
      String(target.port),
    );
  }

  await (await $(S.editorSave)).click();
  await browser.waitUntil(
    async () => (await $(S.connectionTree).getText()).includes(name),
    { timeout: 10_000, timeoutMsg: `Expected ${name} to be saved` },
  );
}

async function openConnection(name: string): Promise<void> {
  const items = await $$(S.connectionItem);
  for (const item of items) {
    if ((await item.getText()).includes(name)) {
      await item.doubleClick();
      await (await $(SEL.panel)).waitForExist({ timeout: 30_000 });
      return;
    }
  }
  throw new Error(`Connection ${name} was not found in the tree`);
}

async function openNasApiSession(
  accountName: MockDsmAccountName,
  target: MockDsmHandle = mockDsm,
): Promise<void> {
  const name = `NAS API ${accountName}`;
  await createNasApiConnection(name, accountName, target);
  await openConnection(name);
}

async function waitForConnected(): Promise<void> {
  // The section sidebar only renders for a connected NAS API session.
  await (
    await $(SEL.systemTab)
  ).waitForExist({
    timeout: 45_000,
    timeoutMsg: "Expected the NAS API session to connect",
  });
}

async function waitForSectionAccess(): Promise<void> {
  const panel = await $(SEL.panel);
  await browser.waitUntil(
    async () => {
      const status = await (
        await $(SEL.systemTab)
      ).getAttribute("data-access-status");
      const checking = await panel.$$(SEL.checkingSection);
      return !!status && status !== "checking" && (await checking.length) === 0;
    },
    {
      timeout: 60_000,
      interval: 250,
      timeoutMsg: "Expected every section access check to finish",
    },
  );
}

async function openSystemSection(): Promise<void> {
  const tab = await $(SEL.systemTab);
  await tab.waitForEnabled({ timeout: 10_000 });
  await tab.click();
  await (await $(SEL.cpuTable)).waitForExist({ timeout: 15_000 });
}

async function accountIdentity(): Promise<string> {
  const identity = await $(SEL.accountIdentity);
  await identity.waitForExist({ timeout: 30_000 });
  return textContent(identity);
}

async function expectNoRawFailureBanner(): Promise<void> {
  const panel = await $(SEL.panel);
  const alertTexts: string[] = [];
  for (const alert of await panel.$$('[role="alert"]')) {
    alertTexts.push(await textContent(alert));
  }
  expect(alertTexts).toEqual([]);
  const text = await textContent(panel);
  expect(text).not.toContain("synology-diagnostic:");
  expect(text).not.toContain('"dsmCode"');
  expect(text).not.toContain("Failed sections have been cleared");
}

const loginsFor = async (account: MockDsmAccountName, target = mockDsm) =>
  (await target.snapshot()).logins.filter(
    (entry: MockDsmLogin) => entry.account === account,
  );

const callsFor = async (
  account: MockDsmAccountName,
  api: string,
  target = mockDsm,
) =>
  (await target.snapshot()).calls.filter(
    (entry: MockDsmCall) => entry.account === account && entry.api === api,
  );

const loginRows = async (account: MockDsmAccountName, target = mockDsm) =>
  (await loginsFor(account, target)).map((entry) => [
    entry.otpCode,
    entry.code,
  ]);

/** Pause until the current TOTP window has at least `minRemainingMs` left. */
async function waitForTotpWindow(minRemainingMs: number): Promise<void> {
  const remaining = TOTP_PERIOD_MS - (Date.now() % TOTP_PERIOD_MS);
  if (remaining < minRemainingMs) await browser.pause(remaining + 250);
}

/**
 * Add an authenticator secret in Synology access → "Two-factor authentication
 * — automatic one-time codes" and select it for the NAS API. Synthetic seeds
 * only.
 */
async function addNasApiAuthenticator(seed: string): Promise<void> {
  const section = await $(SEL.authenticatorSection);
  await section.waitForExist({ timeout: 10_000 });
  await section.scrollIntoView();
  await selectCustomOption(SEL.authenticatorSelect, "Add authenticator secret");
  await setInput(SEL.authenticatorSecret, seed);
  const save = await section.$(SEL.saveAuthenticator);
  await save.waitForEnabled({ timeout: 5_000 });
  await save.click();
  // Saving clears and closes the add form; the seed stays only in the draft.
  await browser.waitUntil(
    async () => !(await $(SEL.authenticatorSecret).isExisting()),
    {
      timeout: 5_000,
      timeoutMsg: "Expected the authenticator secret field to close on save",
    },
  );
  expect(await textContent(await $(SEL.authenticatorSelect))).toContain(
    "Synology DSM",
  );
}

/**
 * "Check code" shows the app's native code for the saved authenticator; it
 * must be one the fixture accepts right now.
 */
async function expectCheckCodeAcceptedBy(target: MockDsmHandle) {
  await waitForTotpWindow(5_000);
  const section = await $(SEL.authenticatorSection);
  const check = await section.$(SEL.checkCode);
  await check.waitForClickable({ timeout: 5_000 });
  await check.click();
  let shown = "";
  await browser.waitUntil(
    async () => {
      const code = await $(SEL.authenticatorCode);
      shown = (await code.isExisting()) ? (await textContent(code)).trim() : "";
      return /^\d{6}$/u.test(shown);
    },
    {
      timeout: 5_000,
      timeoutMsg: "Expected Check code to show a six-digit code",
    },
  );
  const now = Date.now();
  expect(
    [-TOTP_PERIOD_MS, 0, TOTP_PERIOD_MS].map((offset) =>
      mockDsmTotpCode(target.totpSeed, now + offset),
    ),
  ).toContain(shown);
}

/**
 * The four System-tab Utilization notices (CPU, Memory, Network, Disk) all
 * carry `state`, and the CPU table holds one of them. Titles and reasons are
 * fixed e5 copy, never native DSM text.
 */
async function utilizationNotices(state: string) {
  const selector = `${SEL.utilizationRestriction}[data-read-state="${state}"]`;
  await browser.waitUntil(
    async () => (await (await $$(selector)).length) === 4,
    {
      timeout: 20_000,
      timeoutMsg: `Expected four ${state} Resource usage notices on System`,
    },
  );
  const cpuNotice = await (await $(SEL.cpuTable)).$(selector);
  expect(await cpuNotice.isExisting()).toBe(true);
  return cpuNotice;
}

/** Administrator signed in without DSM 7's secure handshake (not `ik`). */
async function expectSessionRestrictedUtilization() {
  const notice = await utilizationNotices("session_restricted");
  expect(await textContent(await notice.$(SEL.restrictionTitle))).toBe(
    "Session restricted",
  );
  expect(await textContent(await notice.$(SEL.restrictionReason))).toMatch(
    /secure login handshake/iu,
  );
  expect(await notice.$(SEL.restrictionReconnect).isExisting()).toBe(true);
  // Only offered once the handshake completed (`ik`) on a non-webui session.
  expect(await notice.$(SEL.restrictionReconnectDsmSession).isExisting()).toBe(
    false,
  );
}

describe("Synology NAS API — permissions and 2FA against the mock DSM", () => {
  before(async () => {
    mockDsm = await startMockDsm({ port: MOCK_DSM_PORT });
  });

  after(async () => {
    await mockDsm?.stop();
  });

  beforeEach(async () => {
    await resetAppState();
    await mockDsm.reset();
    await createCollection("Synology NAS API");
    await (await $(S.connectionTree)).waitForExist({ timeout: 10_000 });
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("shows administrator-only reads as restricted for a standard account without a failure banner", async () => {
    await openNasApiSession("viewer");
    await waitForConnected();
    await waitForSectionAccess();

    expect(
      await (await $(SEL.systemTab)).getAttribute("data-access-status"),
    ).toBe("partial");

    await openSystemSection();
    const notice = await utilizationNotices("requires_administrator");
    expect(await textContent(await notice.$(SEL.restrictionTitle))).toBe(
      "Requires administrator",
    );
    expect(await notice.$(SEL.restrictionReconnect).isExisting()).toBe(false);
    // System information (DSM.Info) is readable, so it is not restricted.
    expect(
      await $(
        `${SEL.readRestriction}[data-read-field="systemInfo"]`,
      ).isExisting(),
    ).toBe(false);

    // Users and groups are both administrator-only → grouped, not a red error.
    const usersEntry = await (await $(SEL.needsAccessGroup)).$(SEL.usersTab);
    await usersEntry.waitForExist({ timeout: 10_000 });
    expect(await usersEntry.getAttribute("data-access-status")).toBe("denied");
    expect(await textContent(usersEntry)).toContain("Requires administrator");

    const identity = await accountIdentity();
    expect(identity).toContain("Signed in as viewer");
    expect(identity).toMatch(/Administrator:\s*no\b/u);
    expect(identity).not.toContain(mockDsm.hostname);
    const accountAccess = await $(SEL.accountAccess);
    expect(await accountAccess.getAttribute("data-tone")).not.toBe("warning");
    expect(await textContent(accountAccess)).toContain(
      "Administrator-only data is hidden for this account.",
    );

    // Let the System loads settle, then prove Refresh does not re-invoke the
    // known-restricted Utilization read and no raw failure banner appears.
    await browser.pause(1_000);
    await expectNoRawFailureBanner();
    const before = await callsFor("viewer", "SYNO.Core.System.Utilization");
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((entry) => entry.code === 105)).toBe(true);
    await (await (await $(SEL.panel)).$(SEL.refresh)).click();
    await browser.pause(3_000);
    expect(
      (await callsFor("viewer", "SYNO.Core.System.Utilization")).length,
    ).toBe(before.length);
    await expectNoRawFailureBanner();
  });

  it("shows the fixture's CPU, user and group data to an administrator", async () => {
    await openNasApiSession("admin");
    await waitForConnected();
    await waitForSectionAccess();
    expect(
      await (await $(SEL.usersTab)).getAttribute("data-access-status"),
    ).toBe("available");
    await openSystemSection();

    const cpu = await $(SEL.cpuTable);
    await browser.waitUntil(
      async () => {
        const text = await textContent(cpu);
        return ["1min_load", "5min_load", "15min_load"].every((key) =>
          text.includes(String(mockDsm.cpu[key])),
        );
      },
      {
        timeout: 20_000,
        timeoutMsg: "Expected the CPU table to show the fixture load values",
      },
    );
    expect(await (await $$(SEL.readRestriction)).length).toBe(0);
    await expectNoRawFailureBanner();

    const identity = await accountIdentity();
    expect(identity).toContain("Signed in as admin");
    expect(identity).toMatch(/Administrator:\s*yes\b/u);

    // Real wire: `{users|groups, offset, total}` with no `uid` / `members`.
    const usersTab = await $(SEL.usersTab);
    await usersTab.waitForEnabled({ timeout: 10_000 });
    await usersTab.click();
    const users = await $(SEL.usersTable);
    const groups = await $(SEL.groupsTable);
    await browser.waitUntil(
      async () =>
        (await users.isExisting()) &&
        (await groups.isExisting()) &&
        (await textContent(users)).includes("viewer") &&
        (await textContent(groups)).includes("administrators"),
      {
        timeout: 20_000,
        timeoutMsg: "Expected the Users and Groups tables to list fixture rows",
      },
    );
    expect(await (await $$(SEL.readRestriction)).length).toBe(0);
    await browser.pause(1_000);
    await expectNoRawFailureBanner();

    // Every probe and loader request had the API, method, version and
    // parameters the fixture's DSM catalog accepts, on either wire.
    expect((await mockDsm.snapshot()).unexpected).toEqual([]);
  });

  it("explains the user's code 105 for a remote administrator signed in without the secure handshake", async () => {
    await openNasApiSession("remote-admin");
    await waitForConnected();
    await waitForSectionAccess();

    // Fixture side: legacy login (no UIConfig advertised, no ik_message) and
    // the exact 38-byte 105 on Utilization from the limited session.
    const [loginRecord] = (await loginsFor("remote-admin")).filter(
      (entry) => entry.code === 0,
    );
    expect(loginRecord.ikMessage).toBe(false);
    expect(loginRecord.version).toBeLessThanOrEqual(6);
    expect((await mockDsm.snapshot()).uiConfigRequests).toBe(0);
    const utilization = await callsFor(
      "remote-admin",
      "SYNO.Core.System.Utilization",
    );
    expect(utilization.length).toBeGreaterThan(0);
    expect(
      utilization.every(
        (entry) => entry.code === 105 && entry.sessionKind === "limited",
      ),
    ).toBe(true);

    const identity = await accountIdentity();
    expect(identity).toContain("Signed in as remote-admin");
    expect(identity).toMatch(/Administrator:\s*yes\b/u);
    expect(identity).toMatch(/Login handshake:\s*legacy\b/u);
    expect(identity).not.toContain("DSM 7 secure");

    const accountAccess = await $(SEL.accountAccess);
    expect(await accountAccess.getAttribute("data-tone")).toBe("warning");
    expect(await accountAccess.$(SEL.reconnect).isExisting()).toBe(true);
    // Only offered once the handshake is complete (`ik`).
    expect(await accountAccess.$(SEL.reconnectDsmSession).isExisting()).toBe(
      false,
    );

    await openSystemSection();
    await expectSessionRestrictedUtilization();
    await browser.pause(1_000);
    await expectNoRawFailureBanner();
  });

  it("stops on DSM's 2FA enrollment requirement without asking for a code", async () => {
    await openNasApiSession("enroll");

    const dialog = await $(SEL.twoFactorDialog);
    await dialog.waitForDisplayed({ timeout: 30_000 });
    await browser.waitUntil(
      async () =>
        /set up two-factor authentication/iu.test(await textContent(dialog)),
      {
        timeout: 10_000,
        timeoutMsg: "Expected the 2FA enrollment message",
      },
    );
    expect(await dialog.$(SEL.otpInput).isExisting()).toBe(false);
    expect(await dialog.$(SEL.verifyCode).isExisting()).toBe(false);
    expect(await $(SEL.systemTab).isExisting()).toBe(false);

    // One login, no retry, no sign-in-method lookup for 406.
    await browser.pause(1_000);
    expect((await loginsFor("enroll")).map((entry) => entry.code)).toEqual([
      406,
    ]);
    expect(
      (await mockDsm.snapshot()).calls.some(
        (entry) => entry.api === "SYNO.API.Auth.Type",
      ),
    ).toBe(false);
  });

  it("asks for a one-time code and connects with the accepted code", async () => {
    await openNasApiSession("otp");

    const dialog = await $(SEL.twoFactorDialog);
    await dialog.waitForDisplayed({ timeout: 30_000 });
    const code = await dialog.$(SEL.otpInput);
    await code.waitForDisplayed({ timeout: 10_000 });
    expect(await $(SEL.systemTab).isExisting()).toBe(false);

    await code.setValue(mockDsm.otpCode);
    const verify = await dialog.$(SEL.verifyCode);
    await verify.waitForEnabled({ timeout: 5_000 });
    await verify.click();

    await waitForConnected();
    const logins = await loginsFor("otp");
    expect(logins.map((entry) => [entry.otpCode, entry.code])).toEqual([
      ["absent", 403],
      ["valid", 0],
    ]);
    // "Trust this device" is opt-in and off by default.
    expect(logins.some((entry) => entry.deviceTokenIssued)).toBe(false);
  });

  it("generates the one-time code from the saved authenticator secret without asking", async () => {
    const name = "NAS API otp-seed automatic code";
    await createNasApiConnection(name, "otp-seed", mockDsm, async () => {
      await addNasApiAuthenticator(mockDsm.totpSeed);
      await expectCheckCodeAcceptedBy(mockDsm);
    });
    await openConnection(name);

    await waitForConnected();
    expect(await $(SEL.twoFactorDialog).isExisting()).toBe(false);
    // DSM asked once; the app answered with one generated code.
    expect(await loginRows("otp-seed")).toEqual([
      ["absent", 403],
      ["valid", 0],
    ]);
    expect(
      (await loginsFor("otp-seed")).some((entry) => entry.deviceTokenIssued),
    ).toBe(false);
  });

  it("falls back to the code dialog with a notice when DSM rejects the generated code", async () => {
    // Valid Base32 (RFC 6238's SHA-1 test key), but not the fixture's seed.
    const wrongSeed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(wrongSeed).not.toBe(mockDsm.totpSeed);
    const name = "NAS API otp-seed wrong secret";
    await createNasApiConnection(name, "otp-seed", mockDsm, () =>
      addNasApiAuthenticator(wrongSeed),
    );
    await openConnection(name);

    // The previous scenario's code may make the app wait for a fresh step.
    const dialog = await $(SEL.twoFactorDialog);
    await dialog.waitForDisplayed({ timeout: 60_000 });
    const notice = await dialog.$(SEL.automaticCodeNotice);
    await notice.waitForExist({ timeout: 10_000 });
    const noticeText = await textContent(notice);
    expect(noticeText).toContain(
      "DSM rejected the code generated from the saved authenticator.",
    );
    expect(noticeText).toMatch(/clock/u);
    expect(await $(SEL.systemTab).isExisting()).toBe(false);

    // One automatic attempt only: no second generated code follows the 404.
    await browser.pause(2_000);
    expect(await loginRows("otp-seed")).toEqual([
      ["absent", 403],
      ["invalid", 404],
    ]);

    const code = await dialog.$(SEL.otpInput);
    await code.waitForDisplayed({ timeout: 10_000 });
    await waitForTotpWindow(5_000);
    await code.setValue(mockDsmTotpCode(mockDsm.totpSeed));
    const verify = await dialog.$(SEL.verifyCode);
    await verify.waitForEnabled({ timeout: 5_000 });
    await verify.click();

    await waitForConnected();
    expect(await loginRows("otp-seed")).toEqual([
      ["absent", 403],
      ["invalid", 404],
      ["valid", 0],
    ]);
  });

  it("names Secure SignIn approval and security keys when DSM requires approval", async () => {
    await openNasApiSession("approve");

    const dialog = await $(SEL.twoFactorDialog);
    await dialog.waitForDisplayed({ timeout: 30_000 });
    await browser.waitUntil(
      async () => {
        const text = await textContent(dialog);
        return (
          /approve-sign-in|Secure SignIn approval/iu.test(text) &&
          /security key/iu.test(text)
        );
      },
      {
        timeout: 10_000,
        timeoutMsg:
          "Expected the unsupported-method message naming Secure SignIn approval and security keys",
      },
    );
    expect(await dialog.$(SEL.otpInput).isExisting()).toBe(false);
    expect(await $(SEL.systemTab).isExisting()).toBe(false);
    expect((await loginsFor("approve")).map((entry) => entry.code)).toEqual([
      449,
    ]);
  });
});

describe("Synology NAS API — secure handshake offered but never completed", () => {
  let handshakeMock: MockDsmHandle;

  before(async () => {
    // Second fixture so the suite above keeps its UIConfig-less server.
    handshakeMock = await startMockDsm({
      port: MOCK_DSM_PORT + 1,
      uiConfig: "no_reply",
    });
  });

  after(async () => {
    await handshakeMock?.stop();
  });

  beforeEach(async () => {
    await resetAppState();
    await handshakeMock.reset();
    await createCollection("Synology NAS API handshake");
    await (await $(S.connectionTree)).waitForExist({ timeout: 10_000 });
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("keeps the session as ik_incomplete, sends no request hash and explains the restriction", async () => {
    await openNasApiSession("remote-admin", handshakeMock);
    await waitForConnected();
    await waitForSectionAccess();

    const snapshot = await handshakeMock.snapshot();
    expect(snapshot.uiConfigRequests).toBeGreaterThan(0);
    const successful = snapshot.logins.filter(
      (entry) => entry.account === "remote-admin" && entry.code === 0,
    );
    expect(successful.length).toBe(1);
    expect(successful[0].version).toBe(7);
    expect(successful[0].ikMessage).toBe(true);
    expect(snapshot.calls.some((entry) => entry.requestHash)).toBe(false);

    const identity = await accountIdentity();
    expect(identity).toContain("Signed in as remote-admin");
    expect(identity).toMatch(/Administrator:\s*yes\b/u);
    expect(identity).toMatch(/Login handshake:\s*DSM 7 secure, incomplete/u);

    await openSystemSection();
    await expectSessionRestrictedUtilization();
    await browser.pause(1_000);
    await expectNoRawFailureBanner();
  });
});

describe("Synology NAS API — automatic codes never reuse a time step", () => {
  let reuseMock: MockDsmHandle;

  before(async () => {
    // Own fixture: this one refuses a second sign-in with the same step, as
    // DSM may, so a reused automatic code would show as ["valid", 404].
    reuseMock = await startMockDsm({
      port: MOCK_DSM_PORT + 2,
      rejectReusedStep: true,
    });
  });

  after(async () => {
    await reuseMock?.stop();
  });

  beforeEach(async () => {
    await resetAppState();
    await reuseMock.reset();
    await createCollection("Synology NAS API reuse");
    await (await $(S.connectionTree)).waitForExist({ timeout: 10_000 });
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("waits for a fresh step when the session is reopened within the same window", async () => {
    const name = "NAS API otp-seed reopen";
    await createNasApiConnection(name, "otp-seed", reuseMock, () =>
      addNasApiAuthenticator(reuseMock.totpSeed),
    );

    // Start early in a window so the reopen lands in the step the first
    // automatic code used; otherwise this scenario proves nothing.
    await waitForTotpWindow(25_000);
    const firstOpenedAt = Date.now();
    await openConnection(name);
    await waitForConnected();
    expect(await loginRows("otp-seed", reuseMock)).toEqual([
      ["absent", 403],
      ["valid", 0],
    ]);

    await closeAllSessions();
    const reopenedAt = Date.now();
    expect(totpStep(reopenedAt)).toBe(totpStep(firstOpenedAt));
    await openConnection(name);

    // The app holds the second code until the next step (≤ 30 s).
    await browser.waitUntil(
      async () => (await loginsFor("otp-seed", reuseMock)).length >= 4,
      {
        timeout: 75_000,
        interval: 250,
        timeoutMsg: "Expected the reopened session to sign in again",
      },
    );
    expect(await loginRows("otp-seed", reuseMock)).toEqual([
      ["absent", 403],
      ["valid", 0],
      ["absent", 403],
      ["valid", 0],
    ]);
    await waitForConnected();
    expect(await $(SEL.twoFactorDialog).isExisting()).toBe(false);
  });
});
