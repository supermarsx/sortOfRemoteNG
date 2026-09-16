import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import type { TOTPConfig } from "../../src/types/settings/settings";
import type { Mgr } from "../../src/components/synology/synologyPanel/types";
import SynologySessionPanel from "../../src/components/synology/SynologySessionPanel";
import type { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
import {
  clearSynologyOtpSubmissions,
  SYNOLOGY_AUTOMATIC_CODE_REJECTED_MESSAGE,
  SYNOLOGY_AUTOMATIC_CODE_UNAVAILABLE_MESSAGE,
} from "../../src/utils/synology/synologyAuthenticator";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  computeCode: vi.fn(),
  dispatch: vi.fn(),
  capabilities: vi.fn(),
}));
let connections: Connection[] = [];
let availability: DatabaseAvailability;
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("../../src/hooks/totp/useTOTP", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/hooks/totp/useTOTP")>();
  return {
    ...actual,
    totpApi: { ...actual.totpApi, computeCode: mocks.computeCode },
  };
});
vi.mock("../../src/hooks/synology/synologyApiCapabilities", () => ({
  verifySynologyApiTransportCapabilities: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: () => <span data-testid="configured-app-loader" />,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections },
    dispatch: mocks.dispatch,
    databaseAvailability: availability,
    credentialVault: undefined,
  }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "db-a" }),
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: "db-a",
        readCurrent: async () => ({ connections }),
        assertAccessible: () => {},
      }),
      onCurrentDatabaseChange: () => () => {},
    }),
  },
  onDatabaseAccessChange: () => () => {},
}));
vi.mock(
  "../../src/utils/runtime/runtimeCapabilities",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    loadRuntimeCapabilities: mocks.capabilities,
  }),
);
// The real sign-in form on the real connection hook; the admin workspace is out of scope.
vi.mock("../../src/components/synology/SynologyPanel", async () => {
  const { default: ConnectionForm } =
    await import("../../src/components/synology/synologyPanel/ConnectionForm");
  return {
    SynologySessionContent: ({
      connection,
    }: {
      connection: ReturnType<typeof useSynologyFileConnection>;
    }) =>
      connection.connectionStatus === "connected" ? (
        <section aria-label="NAS workspace">Signed in</section>
      ) : (
        <ConnectionForm mgr={connection as unknown as Mgr} />
      ),
  };
});

/** Synthetic seed; never a real account's. */
const SEED = "JBSWY3DPEHPK3PXP";
const WRONG_SEED = "GEZDGNBVGY3TQOJQ";
const GENERATED = "287082";
const TYPED = "135790";
/** 1 s into a 30-second window. */
const NOW = 59_633_334 * 30_000 + 1_000;

const authenticator = (patch: Partial<TOTPConfig> = {}): TOTPConfig => ({
  id: "3f2c9a7e-8a41-4a57-9f7e-0f1b2c3d4e5f",
  secret: SEED,
  issuer: "Synology DSM",
  account: "admin",
  digits: 6,
  period: 30,
  algorithm: "sha1",
  ...patch,
});
/** A DSM-website connection in NAS API mode with local credentials. */
const saved = (config: TOTPConfig = authenticator()): Connection => ({
  id: "one",
  name: "one",
  protocol: "https",
  hostname: "nas.example.test",
  port: 5001,
  isGroup: false,
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
  httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
  httpsTrustPolicy: "strict",
  basicAuthUsername: "admin",
  basicAuthPassword: "local-password",
  totpConfigs: [config],
  synologySettings: {
    version: 1,
    useHttps: true,
    accessMode: "native",
    otpAuthenticatorId: "3f2c9a7e-8a41-4a57-9f7e-0f1b2c3d4e5f",
  },
});
const session: ConnectionSession = {
  id: "tab-one",
  connectionId: "one",
  ownerDatabaseId: "db-a",
  name: "one",
  protocol: "https",
  hostname: "nas.example.test",
  status: "connecting",
  startTime: new Date(),
};

type Args = Record<string, unknown>;
const connectCalls = () =>
  mocks.invoke.mock.calls
    .filter(([command]) => command === "syn_fs_connect")
    .map(([, args]) => args as Args);
/** Mock DSM: 403 without a code, 404 for any code but the current one. */
const dsm = async (command: string, args: Args) => {
  if (command === "syn_fs_session_health")
    return {
      status: "connected",
      lastVerifiedAt: "",
      consecutiveFailures: 0,
      message: null,
    };
  if (command !== "syn_fs_connect") return undefined;
  if (!args.otpCode) return { status: "otp_required", methods: ["otp"] };
  return args.otpCode === GENERATED || args.otpCode === TYPED
    ? { status: "connected", sessionId: "receipt-one", message: "ok" }
    : { status: "otp_invalid" };
};
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
const expectNoSeedLeak = () => {
  for (const seed of [SEED, WRONG_SEED]) {
    // The seed goes only to `totp_compute_code`, mocked here as totpApi.
    expect(JSON.stringify(mocks.invoke.mock.calls)).not.toContain(seed);
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(seed);
    expect(document.body.innerHTML).not.toContain(seed);
    for (const spy of consoleSpies)
      expect(JSON.stringify(spy.mock.calls)).not.toContain(seed);
  }
};
const codeDialog = () =>
  screen.findByRole("dialog", { name: "Synology two-factor authentication" });
const enterCode = (dialog: HTMLElement, code: string) => {
  fireEvent.change(within(dialog).getByLabelText("One-time code"), {
    target: { value: code },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Verify code" }));
};
const workspace = () => screen.findByRole("region", { name: "NAS workspace" });
/** Notes whether a code dialog was ever rendered, not just at the end. */
const watchDialogs = () => {
  let seen = false;
  const observer = new MutationObserver(() => {
    if (document.querySelector('[role="dialog"]')) seen = true;
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    return seen;
  };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearSynologyOtpSubmissions();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(dsm);
  mocks.computeCode.mockReset();
  mocks.computeCode.mockImplementation(async (secret: string) =>
    secret === SEED ? GENERATED : "999999",
  );
  mocks.dispatch.mockClear();
  availability = { status: "ready", databaseId: "db-a", generation: 1 };
  mocks.capabilities.mockResolvedValue({
    source: "native",
    ops: true,
    platform: true,
  });
  for (const method of ["log", "info", "warn", "error", "debug"] as const)
    consoleSpies.push(vi.spyOn(console, method));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  consoleSpies.splice(0).forEach((spy) => spy.mockRestore());
});

describe("NAS API sign-in with a saved authenticator", () => {
  it("answers DSM's 403 with one generated code and opens the workspace without a dialog", async () => {
    connections = [saved()];
    const dialogShown = watchDialogs();
    render(<SynologySessionPanel session={session} />);
    expect(await workspace()).toBeVisible();
    expect(dialogShown()).toBe(false);
    expect(mocks.computeCode).toHaveBeenCalledExactlyOnceWith(
      SEED,
      "SHA1",
      6,
      30,
    );
    const [initial, verified] = connectCalls();
    expect(connectCalls()).toHaveLength(2);
    expect(initial).toMatchObject({
      host: "nas.example.test",
      username: "admin",
      password: "local-password",
      otpCode: null,
    });
    expect(verified).toMatchObject({
      username: "admin",
      password: "local-password",
      otpCode: GENERATED,
    });
    expect(verified.requestId).not.toBe(initial.requestId);
    for (const key of ["trustDevice", "deviceId", "deviceName"])
      expect(verified).not.toHaveProperty(key);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expectNoSeedLeak();
  });

  it("falls back to the code dialog with the rejected notice when the saved secret is wrong", async () => {
    connections = [saved(authenticator({ secret: WRONG_SEED }))];
    const dialogShown = watchDialogs();
    render(<SynologySessionPanel session={session} />);
    const dialog = await codeDialog();
    expect(dialogShown()).toBe(true);
    const notice = await within(dialog).findByTestId(
      "synology-automatic-code-notice",
    );
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent(SYNOLOGY_AUTOMATIC_CODE_REJECTED_MESSAGE);
    expect(dialog).toHaveTextContent(
      "The one-time code was not accepted. Enter a fresh code.",
    );
    expect(connectCalls().map((args) => args.otpCode)).toEqual([
      null,
      "999999",
    ]);
    enterCode(dialog, TYPED);
    expect(await workspace()).toBeVisible();
    expect(mocks.computeCode).toHaveBeenCalledOnce();
    expect(connectCalls().map((args) => args.otpCode)).toEqual([
      null,
      "999999",
      TYPED,
    ]);
    expectNoSeedLeak();
  });

  it("asks for a typed code with the unavailable notice when an export removed the secret", async () => {
    connections = [saved(authenticator({ secret: "" }))];
    render(<SynologySessionPanel session={session} />);
    const dialog = await codeDialog();
    expect(
      await within(dialog).findByTestId("synology-automatic-code-notice"),
    ).toHaveTextContent(SYNOLOGY_AUTOMATIC_CODE_UNAVAILABLE_MESSAGE);
    expect(dialog).toHaveTextContent(
      "Enter the current one-time code from your authenticator.",
    );
    expect(mocks.computeCode).not.toHaveBeenCalled();
    expect(connectCalls()).toHaveLength(1);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    enterCode(dialog, TYPED);
    expect(await workspace()).toBeVisible();
    expect(connectCalls().map((args) => args.otpCode)).toEqual([null, TYPED]);
    expectNoSeedLeak();
  });

  it("asks for a typed code when the native generator fails, without echoing its error", async () => {
    connections = [saved()];
    mocks.computeCode.mockRejectedValue(
      new Error(`Invalid base32 secret ${SEED}`),
    );
    render(<SynologySessionPanel session={session} />);
    const dialog = await codeDialog();
    expect(
      await within(dialog).findByTestId("synology-automatic-code-notice"),
    ).toHaveTextContent(SYNOLOGY_AUTOMATIC_CODE_UNAVAILABLE_MESSAGE);
    expect(dialog).not.toHaveTextContent("base32");
    expect(connectCalls()).toHaveLength(1);
    expectNoSeedLeak();
  });

  it("keeps a connection without a selected authenticator on the ordinary code dialog", async () => {
    const plain = saved();
    delete plain.synologySettings!.otpAuthenticatorId;
    connections = [plain];
    render(<SynologySessionPanel session={session} />);
    const dialog = await codeDialog();
    expect(
      within(dialog).queryByTestId("synology-automatic-code-notice"),
    ).not.toBeInTheDocument();
    expect(mocks.computeCode).not.toHaveBeenCalled();
    expect(connectCalls()).toHaveLength(1);
  });
});
