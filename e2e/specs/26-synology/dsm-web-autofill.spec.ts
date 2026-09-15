// t85-e6 — Synology DSM website auto-fill in the embedded web view.
//
// Opens a saved HTTPS "Synology DSM" connection with Automatic form login
// against the synthetic DSM website in compose service `test-dsm-web`
// (e2e/fixtures/synology-dsm-web). The real app proxies the page and injects
// the production DSM helper; the fixture records the DSM-side submissions:
// one `SYNO.API.Auth.Type` lookup per username release and one
// `SYNO.API.Auth` login per password release. No real or Virtual DSM, no
// real account: the credentials are the shared synthetic placeholders.
//
// Scenarios (direct URL; QuickConnect relays cannot be reproduced locally):
//   standard  vue-router boot ('' -> #/ -> #/signin) -> "Auto-fill: signed in"
//   slow      32 s parser-blocked document, then a 35 s splash on #/, then the
//             login form -> "signed in" with no stopped/timed-out pill on the way
//   otp       DSM asks for the authenticator code after Sign in ->
//             "Auto-fill: filled — enter your 2FA code", which stays (a hand-off)
//
// Opt-in tier: skipped when Docker is unavailable. Needs the
// `cargo tauri build --debug` binary via TAURI_BINARY_PATH and OpenSSL for the
// disposable certificate from scripts/ci/e2e-http-fixtures.mjs.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DsmWebHits,
  DsmWebState,
  DsmWebVariant,
} from "../../fixtures/synology-dsm-web/fixture";
import {
  closeAllSessions,
  createCollection,
  resetAppState,
} from "../../helpers/app";
import {
  isDockerAvailable,
  startContainers,
  stopContainers,
  waitForContainer,
} from "../../helpers/docker";
import { selectCustomOption } from "../../helpers/forms";
import { S } from "../../helpers/selectors";

const SERVICE = "test-dsm-web";
const DSM_WEB_HOST = "127.0.0.1";
const DSM_WEB_PORT = 8446;
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const HTTP_FIXTURES_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/ci/e2e-http-fixtures.mjs",
);
const TLS_CERT = path.join(REPO_ROOT, "e2e/.generated/http/ssl/server.crt");

const PILL =
  '[aria-label="Website connection information"] button[aria-label="Refresh saved login status"]';
const SIGNED_IN = "Auto-fill: signed in";
const OTP_HANDOFF = "Auto-fill: filled — enter your 2FA code";
// Any of these before the expected outcome is the reported bug class. An
// "already signed in" pill during the splash would be a misfire, not success.
const FAILURE_PILL =
  /^Auto-fill: (stopped|timed out|expired|cancelled|sign-in rejected|already signed in|access changed)\b/;
const MODE_FORM = "Automatic form login — explicitly opt in";

type Scenario = ReturnType<DsmWebState["scenario"]>;
type PillEntry = { t: number; text: string };

function fixtureRequest<T>(method: "GET" | "POST", pathname: string) {
  return new Promise<T>((resolve, reject) => {
    const request = https.request(
      {
        host: DSM_WEB_HOST,
        port: DSM_WEB_PORT,
        method,
        path: pathname,
        ca: readFileSync(TLS_CERT),
        timeout: 10_000,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () => {
          if (response.statusCode === 200) resolve(JSON.parse(body) as T);
          else
            reject(
              new Error(
                `${method} ${pathname} -> ${response.statusCode}: ${body}`,
              ),
            );
        });
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error(`${method} ${pathname} timed out`)),
    );
    request.on("error", reject);
    request.end();
  });
}
const fixtureHits = () => fixtureRequest<DsmWebHits>("GET", "/__fixture/hits");

/** The disposable certificate only lasts two days; renew it when stale. */
function ensureDisposableTls(): void {
  let fresh = false;
  try {
    execFileSync(process.execPath, [HTTP_FIXTURES_SCRIPT, "validate"], {
      stdio: "pipe",
    });
    const validTo = Date.parse(
      new X509Certificate(readFileSync(TLS_CERT)).validTo,
    );
    fresh = validTo - Date.now() > 60 * 60 * 1000;
  } catch {
    fresh = false;
  }
  if (!fresh)
    execFileSync(process.execPath, [HTTP_FIXTURES_SCRIPT, "prepare"], {
      stdio: "inherit",
    });
}

// ── app side ────────────────────────────────────────────────────────────────

async function findConnection(name: string) {
  const items = await $$(S.connectionItem);
  for (const item of items) {
    if ((await item.getText()).includes(name)) return item;
  }
  throw new Error(`Connection ${name} was not found`);
}

async function createDsmWebConnection(
  name: string,
  account: Scenario["account"],
): Promise<void> {
  await (await $(S.toolbarNewConnection)).click();
  await (await $(S.editorPanel)).waitForDisplayed({ timeout: 10_000 });
  await (await $(S.editorName)).setValue(name);
  await selectCustomOption(S.editorProtocol, "HTTPS");
  await (await $(S.editorHostname)).setValue(DSM_WEB_HOST);
  const port = await $(S.editorPort);
  await port.clearValue();
  await port.setValue(String(DSM_WEB_PORT));

  await (await $('[data-testid="connection-editor-tab-protocol"]')).click();
  const application = await $(
    '[data-testid="connection-editor-protocol-subtab-application"]',
  );
  await application.waitForClickable({ timeout: 10_000 });
  await application.click();
  await selectCustomOption("#http-application-profile", "Synology DSM");
  await selectCustomOption("#http-application-mode", MODE_FORM);
  const username = await $("#http-application-user");
  await username.waitForDisplayed({ timeout: 5_000 });
  await username.setValue(account.username);
  await (await $("#http-application-password")).setValue(account.password);

  await (await $(S.editorSave)).click();
  await browser.waitUntil(
    async () => (await findConnection(name).catch(() => null)) !== null,
    { timeout: 10_000, timeoutMsg: `Expected ${name} to be saved` },
  );
}

async function connectFromTree(name: string): Promise<void> {
  const item = await findConnection(name);
  await item.click({ button: "right" });
  const menu = await $('[data-testid="connection-tree-item-menu"]');
  await menu.waitForDisplayed({ timeout: 5_000 });
  const connect = await menu.$("button=Connect");
  await connect.waitForClickable({ timeout: 5_000 });
  await connect.click();
}

/** Records every distinct pill text from before Connect onwards, so a
 * transient stopped/timed-out state cannot slip between polls. */
async function installPillRecorder(): Promise<void> {
  await browser.execute((selector: string) => {
    type Recorder = {
      entries: { t: number; text: string }[];
      observer: MutationObserver;
      timer: number;
    };
    const host = window as unknown as { __dsmWebPill?: Recorder };
    if (host.__dsmWebPill) {
      host.__dsmWebPill.observer.disconnect();
      window.clearInterval(host.__dsmWebPill.timer);
    }
    const started = Date.now();
    const entries: Recorder["entries"] = [];
    const sample = () => {
      const pill = document.querySelector(selector);
      const text = (pill?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (
        text &&
        entries[entries.length - 1]?.text !== text &&
        entries.length < 500
      )
        entries.push({ t: Date.now() - started, text });
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    host.__dsmWebPill = {
      entries,
      observer,
      timer: window.setInterval(sample, 100),
    };
    sample();
  }, PILL);
}

async function pillHistory(): Promise<PillEntry[]> {
  return browser.execute(
    () =>
      (window as unknown as { __dsmWebPill?: { entries: PillEntry[] } })
        .__dsmWebPill?.entries ?? [],
  );
}

async function pillState(): Promise<{ text: string; detail: string }> {
  return browser.execute((selector: string) => {
    const pill = document.querySelector(selector);
    return {
      text: (pill?.textContent ?? "").replace(/\s+/g, " ").trim(),
      detail: pill?.getAttribute("title") ?? "",
    };
  }, PILL);
}

/** Pill history, the pill's detail (native status plus the closed page-helper
 * trace) and the fixture's recorded submissions. No secret values. */
async function diagnostics(): Promise<string> {
  const settle = <T>(value: Promise<T>) =>
    value.catch((error: unknown) => `unavailable: ${String(error)}`);
  const [pill, history, hits] = await Promise.all([
    settle(pillState()),
    settle(pillHistory()),
    settle(fixtureHits()),
  ]);
  return JSON.stringify({ pill, history, hits }, null, 2);
}

async function failWith(message: string): Promise<never> {
  throw new Error(`${message}\n${await diagnostics()}`);
}

/** Answers a displayed certificate prompt: first use is accepted once, not
 * remembered. A certificate regenerated since an earlier remembered run shows
 * the mismatch form, which needs the explicit verification checkbox. */
async function answerCertificatePrompt(): Promise<boolean> {
  const accept = await $(
    '//button[contains(normalize-space(.), "& Continue")]',
  );
  if (!(await accept.isDisplayed().catch(() => false))) return false;
  const verify = await $(
    '//label[contains(normalize-space(.), "independently verified")]//input[@type="checkbox"]',
  );
  if (
    (await verify.isExisting().catch(() => false)) &&
    !(await verify.isSelected())
  )
    await verify.click();
  await accept.waitForClickable({ timeout: 5_000 });
  await accept.click();
  await accept.waitForDisplayed({ timeout: 15_000, reverse: true });
  return true;
}

async function openDsmWebsite(
  variant: DsmWebVariant,
  name: string,
): Promise<Scenario> {
  const scenario = await fixtureRequest<Scenario>(
    "POST",
    `/__fixture/reset?variant=${variant}`,
  );
  await createDsmWebConnection(name, scenario.account);
  await installPillRecorder();
  await connectFromTree(name);
  return scenario;
}

/** Waits for `expected`, answering certificate prompts as they appear and
 * failing fast on any failure pill on the way. */
async function waitForPill(expected: string, timeout: number): Promise<void> {
  let failure: PillEntry | undefined;
  let reached = false;
  let prompts = 0;
  await browser
    .waitUntil(
      async () => {
        if (prompts < 3 && (await answerCertificatePrompt())) {
          prompts += 1;
          return false;
        }
        failure = (await pillHistory()).find((entry) =>
          FAILURE_PILL.test(entry.text),
        );
        reached = (await pillState()).text.startsWith(expected);
        return reached || failure !== undefined;
      },
      { timeout, interval: 500 },
    )
    .catch(() => undefined);
  if (failure)
    await failWith(`Auto-fill showed "${failure.text}" at ${failure.t} ms`);
  if (!reached)
    await failWith(
      `Expected "${expected}" within ${timeout} ms (${prompts} certificate prompt(s) answered)`,
    );
}

async function expectNoFailurePill(): Promise<PillEntry[]> {
  const history = await pillHistory();
  const failure = history.find((entry) => FAILURE_PILL.test(entry.text));
  if (failure)
    await failWith(`Auto-fill showed "${failure.text}" at ${failure.t} ms`);
  return history;
}

/** Exactly one username release and one password release reached DSM. */
async function expectOneSubmissionPerStage(
  outcome: DsmWebHits["login"][number]["outcome"],
): Promise<DsmWebHits> {
  const hits = await fixtureHits();
  const [lookup] = hits.authType;
  const [login] = hits.login;
  if (
    hits.authType.length !== 1 ||
    !lookup?.accountMatches ||
    hits.login.length !== 1 ||
    !login?.accountMatches ||
    !login.passwordMatches ||
    login.otpCode ||
    login.outcome !== outcome
  )
    await failWith(
      `Expected one username and one password submission ending "${outcome}"`,
    );
  expect(hits.authType.length).toBe(1);
  expect(hits.login.length).toBe(1);
  return hits;
}

/** Submissions and pill must not change after the terminal outcome. */
async function expectSettled(text: string, ms: number): Promise<void> {
  const before = await fixtureHits();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await browser.pause(1_000);
    const current = (await pillState()).text;
    if (!current.startsWith(text))
      await failWith(`Auto-fill changed from "${text}" to "${current}"`);
  }
  const after = await fixtureHits();
  expect(after.authType.length).toBe(before.authType.length);
  expect(after.login.length).toBe(before.login.length);
  expect(after.documents.length).toBe(before.documents.length);
}

describe("Synology DSM website auto-fill (docker fake DSM)", function () {
  this.timeout(360_000);
  let dockerAvailable = false;

  before(async function () {
    dockerAvailable = isDockerAvailable();
    if (!dockerAvailable) {
      console.warn(
        "[dsm-web-autofill.spec] Docker not available — skipping suite",
      );
      this.skip();
      return;
    }
    ensureDisposableTls();
    // Recreate so the fixture serves the current disposable certificate.
    stopContainers([SERVICE]);
    startContainers([SERVICE]);
    await waitForContainer(SERVICE, DSM_WEB_PORT, 90_000);
    await fixtureRequest("GET", "/__fixture/health");
  });

  after(() => {
    if (dockerAvailable) stopContainers([SERVICE]);
  });

  beforeEach(async () => {
    await resetAppState();
    await createCollection("DSM website auto-fill");
    await (await $(S.connectionTree)).waitForExist({ timeout: 10_000 });
  });

  afterEach(async () => {
    await closeAllSessions();
  });

  it("fills the username and password once and reports signed in", async () => {
    const scenario = await openDsmWebsite("standard", "DSM direct");
    expect(scenario.expected).toEqual({
      phase: "signed_in",
      reason: "left-signin-page",
      handoff: null,
    });

    await waitForPill(SIGNED_IN, 90_000);
    await expectOneSubmissionPerStage("signed-in");
    await expectNoFailurePill();
    await expectSettled(SIGNED_IN, 5_000);
  });

  it("waits through a slow DSM boot without a stopped or timed-out pill", async () => {
    const scenario = await openDsmWebsite("slow", "DSM slow boot");
    expect(scenario.bootChunkDelayMs * scenario.bootChunks).toBeGreaterThan(
      30_000,
    );

    await waitForPill(SIGNED_IN, 200_000);
    const hits = await expectOneSubmissionPerStage("signed-in");
    const history = await expectNoFailurePill();
    await expectSettled(SIGNED_IN, 5_000);

    // The slow path really ran: chained boot chunks held the document, then
    // the splash stayed on #/ for 35 s before the login form rendered.
    const chunk = (id: string) =>
      hits.bootChunks.find((entry) => entry.chunk === id)?.t ?? -1;
    expect(chunk("1")).toBeGreaterThanOrEqual(0);
    expect(chunk("2") - chunk("1")).toBeGreaterThanOrEqual(
      scenario.bootChunkDelayMs - 1_000,
    );
    const account = hits.page.find(
      (entry) => entry.event === "step" && entry.detail === "account",
    );
    expect(account?.t ?? 0).toBeGreaterThanOrEqual(35_000);
    // The pill was observed while DSM was still booting, not only at the end.
    expect(history.some((entry) => !entry.text.startsWith(SIGNED_IN))).toBe(
      true,
    );
  });

  it("hands off to the authenticator code step after filling both stages", async () => {
    const scenario = await openDsmWebsite("otp", "DSM with 2FA");
    expect(scenario.expected).toEqual({
      phase: "stopped",
      reason: "interactive-step-required",
      handoff: "otp",
    });

    await waitForPill(OTP_HANDOFF, 90_000);
    const hits = await expectOneSubmissionPerStage("otp-required");
    expect(hits.page.some((entry) => entry.detail === "otp")).toBe(true);
    await expectNoFailurePill();

    // A hand-off stays: no code is entered, nothing is retried.
    await expectSettled(OTP_HANDOFF, 20_000);
    const after = await fixtureHits();
    expect(after.login.filter((entry) => entry.otpCode).length).toBe(0);
    expect(after.page.some((entry) => entry.event === "otp-click")).toBe(false);
  });
});
