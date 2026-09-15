import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import type {
  DatabaseCredentialVault,
  DatabaseCredentialVaultApi,
  VaultDeviceTrustFacet,
} from "../../src/types/security/databaseCredentialVault";
import type {
  SynologyDeviceTrustAdapter,
  SynologyDeviceTrustWrite,
  SynologyTrustedDevice,
} from "../../src/types/hardware/synologyFileStation";
import type { Mgr } from "../../src/components/synology/synologyPanel/types";
import SynologySessionPanel from "../../src/components/synology/SynologySessionPanel";
import {
  SYNOLOGY_TRUSTED_DEVICE_FORGOTTEN,
  SYNOLOGY_TRUSTED_DEVICE_MISMATCH,
  SYNOLOGY_TRUSTED_DEVICE_NOT_ISSUED,
  SYNOLOGY_TRUSTED_DEVICE_REJECTED,
  SYNOLOGY_TRUSTED_DEVICE_SAVED,
  useSynologyFileConnection,
  type SynologyFileConnectionOptions,
} from "../../src/hooks/synology/useSynologyFileConnection";
import {
  applyDatabaseCredentialChanges,
  databaseCredentialMetadata,
  normalizeDatabaseCredentialVault,
  selectDatabaseCredentialFacets,
} from "../../src/utils/security/databaseCredentialVault";
import {
  DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE,
  DEVICE_TRUST_NOT_REMEMBERED_MESSAGE,
  DEVICE_TRUST_VAULT_REQUIRED_MESSAGE,
} from "../../src/utils/security/runtimeCredentialVault";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  capabilities: vi.fn(),
}));
let connections: Connection[] = [];
let availability: DatabaseAvailability;
let vaultApi: DatabaseCredentialVaultApi | undefined;
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
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
    credentialVault: vaultApi,
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

const DEVICE_ID = "PRIVATE_DEVICE_TOKEN_did_0123456789";
const DEVICE_NAME = "SortOfRemoteNG · DESKTOP-ONE";
const TARGET = "https://one.example.test:5001";
const credentialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = "2026-09-15T00:00:00.000Z";
const device: SynologyTrustedDevice = {
  deviceName: DEVICE_NAME,
  deviceId: DEVICE_ID,
};
const trustRow = (): VaultDeviceTrustFacet => ({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  surface: "synology-api",
  target: TARGET,
  account: "admin",
  deviceName: DEVICE_NAME,
  deviceId: DEVICE_ID,
  createdAt: now,
  portable: false,
});

/** In-memory reviewed vault; a write publishes a new API revision like the provider. */
function fakeVault(rows?: VaultDeviceTrustFacet[]) {
  let data: DatabaseCredentialVault = normalizeDatabaseCredentialVault({
    version: 1,
    revision: 0,
    entries: [
      {
        id: credentialId,
        name: "NAS admin",
        createdAt: now,
        updatedAt: now,
        facets: {
          username: "admin",
          password: "PRIVATE_PASSWORD",
          ...(rows ? { deviceTrust: rows } : {}),
        },
      },
    ],
  });
  const scope = { databaseId: "db-a", generation: 1 };
  const control = { failWrites: false };
  vaultApi = {
    scope,
    changeRevision: 0,
    list: vi.fn<DatabaseCredentialVaultApi["list"]>(async () => ({
      scope: { ...scope },
      revision: data.revision,
      receipt: `review-${data.revision}`,
      entries: data.entries.map(databaseCredentialMetadata),
    })),
    resolve: vi.fn<DatabaseCredentialVaultApi["resolve"]>(
      async (snapshot, entryId, facets) => {
        if (snapshot.revision !== data.revision)
          throw new Error("The credential vault review expired.");
        return selectDatabaseCredentialFacets(
          data.entries.find((entry) => entry.id === entryId)!,
          facets,
        );
      },
    ),
    compareAndSwap: vi.fn<DatabaseCredentialVaultApi["compareAndSwap"]>(
      async (snapshot, changes) => {
        if (control.failWrites || snapshot.revision !== data.revision)
          throw new Error("The credential vault changed since this review.");
        data = applyDatabaseCredentialChanges(data, changes);
        vaultApi = { ...vaultApi!, changeRevision: data.revision };
      },
    ),
  };
  const api = vaultApi;
  return {
    api,
    control,
    rows: () => data.entries[0].facets.deviceTrust ?? [],
  };
}

const saved = (patch: Partial<Connection> = {}): Connection => ({
  id: "one",
  name: "one",
  protocol: "synology",
  hostname: "one.example.test",
  port: 5001,
  username: "local-user",
  password: "local-password",
  isGroup: false,
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
  credentialSource: { kind: "vault", credentialId },
  ...patch,
});
const session: ConnectionSession = {
  id: "tab-one",
  connectionId: "one",
  ownerDatabaseId: "db-a",
  name: "one",
  protocol: "synology",
  hostname: "one.example.test",
  status: "connecting",
  startTime: new Date(),
};

type Args = Record<string, unknown>;
const connectCalls = () =>
  mocks.invoke.mock.calls
    .filter(([command]) => command === "syn_fs_connect")
    .map(([, args]) => args as Args);
/** Mock DSM: code 123456, optional trusted-device outcome for a sent `deviceId`. */
const dsm =
  (savedDevice: "accept" | "rejected" | "mismatch" = "accept") =>
  async (command: string, args: Args) => {
    if (command === "syn_fs_session_health")
      return {
        status: "connected",
        lastVerifiedAt: "",
        consecutiveFailures: 0,
        message: null,
      };
    if (command !== "syn_fs_connect") return undefined;
    if (args.deviceId && savedDevice === "accept")
      return { status: "connected", sessionId: "receipt-one", message: "ok" };
    if (!args.otpCode)
      return {
        status: "otp_required",
        message: `native text ${String(args.deviceId ?? "")}`,
        ...(args.deviceId && savedDevice === "rejected"
          ? { trustedDeviceRejected: true }
          : {}),
        ...(args.deviceId && savedDevice === "mismatch"
          ? { trustedDeviceMismatch: true }
          : {}),
      };
    if (args.otpCode !== "123456") return { status: "otp_invalid" };
    return {
      status: "connected",
      sessionId: "receipt-one",
      message: "ok",
      ...(args.trustDevice === true ? { trustedDevice: device } : {}),
    };
  };
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
const expectNoDeviceIdLeak = () => {
  expect(document.body.innerHTML).not.toContain(DEVICE_ID);
  expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(DEVICE_ID);
  for (const spy of consoleSpies)
    expect(JSON.stringify(spy.mock.calls)).not.toContain(DEVICE_ID);
};
const codeDialog = () =>
  screen.findByRole("dialog", { name: "Synology two-factor authentication" });
const enterCode = (dialog: HTMLElement) => {
  fireEvent.change(within(dialog).getByLabelText("One-time code"), {
    target: { value: "123456" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Verify code" }));
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.dispatch.mockClear();
  vaultApi = undefined;
  availability = { status: "ready", databaseId: "db-a", generation: 1 };
  mocks.capabilities.mockResolvedValue({
    source: "native",
    ops: true,
    platform: true,
  });
  mocks.invoke.mockImplementation(dsm());
  for (const method of ["log", "info", "warn", "error", "debug"] as const)
    consoleSpies.push(vi.spyOn(console, method));
});
afterEach(() => {
  cleanup();
  consoleSpies.splice(0).forEach((spy) => spy.mockRestore());
});

describe("Trust this device in a saved NAS API session", () => {
  it("stores DSM's device once when the code prompt checkbox is ticked, then signs in with it and no code next time", async () => {
    const vault = fakeVault();
    connections = [saved()];
    const first = render(<SynologySessionPanel session={session} />);
    const dialog = await codeDialog();
    const box = within(dialog).getByRole("checkbox", {
      name: "Trust this device for this NAS account",
    });
    expect(box).not.toBeChecked();
    expect(box).toBeEnabled();
    expect(
      within(dialog).getByText(/DSM remembers this computer/),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/does not remember a device/),
    ).not.toBeInTheDocument();
    fireEvent.click(box);
    enterCode(dialog);
    expect(
      await screen.findByText(SYNOLOGY_TRUSTED_DEVICE_SAVED),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "NAS workspace" })).toBeVisible();
    expect(vault.api.compareAndSwap).toHaveBeenCalledOnce();
    expect(vault.rows()).toEqual([
      expect.objectContaining({
        surface: "synology-api",
        target: TARGET,
        account: "admin",
        deviceName: DEVICE_NAME,
        deviceId: DEVICE_ID,
        portable: false,
      }),
    ]);
    const [initial, verified] = connectCalls();
    expect(initial).toMatchObject({ otpCode: null, username: "admin" });
    for (const key of ["trustDevice", "deviceId", "deviceName"])
      expect(initial).not.toHaveProperty(key);
    expect(verified).toMatchObject({ otpCode: "123456", trustDevice: true });
    expect(verified).not.toHaveProperty("deviceId");
    expect(
      screen.getByRole("button", { name: "Forget this device" }),
    ).toBeInTheDocument();
    expectNoDeviceIdLeak();

    first.unmount();
    mocks.invoke.mockClear();
    render(<SynologySessionPanel session={{ ...session, id: "tab-two" }} />);
    expect(
      await screen.findByRole("region", { name: "NAS workspace" }),
    ).toBeInTheDocument();
    expect(connectCalls()).toEqual([
      expect.objectContaining({
        otpCode: null,
        deviceId: DEVICE_ID,
        deviceName: DEVICE_NAME,
      }),
    ]);
    expect(connectCalls()[0]).not.toHaveProperty("trustDevice");
    expect(
      screen.queryByRole("dialog", {
        name: "Synology two-factor authentication",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("synology-trusted-device")).toHaveTextContent(
      "This computer is a trusted device for this NAS account.",
    );
    expect(vault.api.compareAndSwap).toHaveBeenCalledOnce();
    expectNoDeviceIdLeak();
  });

  it("starts the checkbox from the saved preference", async () => {
    fakeVault();
    connections = [
      saved({
        synologySettings: { version: 1, useHttps: true, trustDevice: true },
      }),
    ];
    render(<SynologySessionPanel session={session} />);
    const dialog = await codeDialog();
    const box = within(dialog).getByRole("checkbox", {
      name: "Trust this device for this NAS account",
    });
    expect(box).toBeChecked();
    fireEvent.click(box);
    enterCode(dialog);
    await screen.findByRole("region", { name: "NAS workspace" });
    expect(connectCalls()[1]).not.toHaveProperty("trustDevice");
  });

  it.each([
    ["rejected", SYNOLOGY_TRUSTED_DEVICE_REJECTED],
    ["mismatch", SYNOLOGY_TRUSTED_DEVICE_MISMATCH],
  ] as const)(
    "forgets a %s saved device, explains it, and continues with the code prompt",
    async (outcome, notice) => {
      const vault = fakeVault([trustRow()]);
      connections = [saved()];
      mocks.invoke.mockImplementation(dsm(outcome));
      render(<SynologySessionPanel session={session} />);
      const dialog = await codeDialog();
      expect(within(dialog).getByRole("status")).toHaveTextContent(notice);
      await waitFor(() => expect(vault.rows()).toEqual([]));
      expect(vault.api.compareAndSwap).toHaveBeenCalledOnce();
      expect(within(dialog).getByLabelText("One-time code")).toBeEnabled();
      expectNoDeviceIdLeak();
      enterCode(dialog);
      await screen.findByRole("region", { name: "NAS workspace" });
      const [withDevice, withCode] = connectCalls();
      expect(withDevice).toMatchObject({ deviceId: DEVICE_ID, otpCode: null });
      expect(withCode).toMatchObject({ otpCode: "123456" });
      expect(withCode).not.toHaveProperty("deviceId");
      expect(withCode).not.toHaveProperty("deviceName");
      expect(
        screen.queryByTestId("synology-trusted-device"),
      ).not.toBeInTheDocument();
      expectNoDeviceIdLeak();
    },
  );

  it("forgets the trusted device from the signed-in session without ending it", async () => {
    const vault = fakeVault([trustRow()]);
    connections = [saved()];
    render(<SynologySessionPanel session={session} />);
    const workspace = await screen.findByRole("region", {
      name: "NAS workspace",
    });
    fireEvent.click(screen.getByRole("button", { name: "Forget this device" }));
    expect(
      await screen.findByText(SYNOLOGY_TRUSTED_DEVICE_FORGOTTEN),
    ).toBeInTheDocument();
    expect(vault.rows()).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Forget this device" }),
    ).not.toBeInTheDocument();
    // The workspace stayed mounted while the bar changed above it.
    expect(screen.getByRole("region", { name: "NAS workspace" })).toBe(
      workspace,
    );
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "syn_fs_disconnect",
      ),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.queryByTestId("synology-trusted-device"),
    ).not.toBeInTheDocument();
  });

  it("never blocks sign-in when the vault can't remember the device", async () => {
    const vault = fakeVault();
    vault.control.failWrites = true;
    connections = [saved()];
    render(<SynologySessionPanel session={session} />);
    const dialog = await codeDialog();
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "Trust this device for this NAS account",
      }),
    );
    enterCode(dialog);
    await screen.findByRole("region", { name: "NAS workspace" });
    expect(
      await screen.findByText(DEVICE_TRUST_NOT_REMEMBERED_MESSAGE),
    ).toBeInTheDocument();
    expect(vault.rows()).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Forget this device" }),
    ).not.toBeInTheDocument();
    expectNoDeviceIdLeak();
  });

  it("shows the checkbox disabled with an explanation for local credentials and never asks DSM to trust", async () => {
    connections = [saved({ credentialSource: undefined })];
    render(<SynologySessionPanel session={session} />);
    const dialog = await codeDialog();
    const box = within(dialog).getByRole("checkbox", {
      name: "Trust this device for this NAS account",
    });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(
      DEVICE_TRUST_VAULT_REQUIRED_MESSAGE,
    );
    enterCode(dialog);
    await screen.findByRole("region", { name: "NAS workspace" });
    for (const args of connectCalls())
      for (const key of ["trustDevice", "deviceId", "deviceName"])
        expect(args).not.toHaveProperty(key);
    expect(
      screen.queryByTestId("synology-trusted-device"),
    ).not.toBeInTheDocument();
  });
});

describe("trusted-device sign-in rules", () => {
  const adapter = (savedDevice: SynologyTrustedDevice | null = null) => ({
    resolve: vi.fn<SynologyDeviceTrustAdapter["resolve"]>(
      async (assertAttempt) => {
        assertAttempt();
        return savedDevice;
      },
    ),
    store: vi.fn<SynologyDeviceTrustAdapter["store"]>(async (assertCurrent) => {
      assertCurrent();
      return { status: "saved" };
    }),
    forget: vi.fn<SynologyDeviceTrustAdapter["forget"]>(
      async (assertCurrent) => {
        assertCurrent();
        return { status: "saved" };
      },
    ),
  });
  const resolveCredentials = vi.fn(async (assertAttempt: () => void) => ({
    username: "admin",
    password: "vault-secret",
    assertCurrent: assertAttempt,
  }));
  const resolveOtp = vi.fn(async (assertAttempt: () => void) => ({
    code: "123456",
    assertCurrent: assertAttempt,
  }));
  const vaultHook = (options: SynologyFileConnectionOptions) => {
    // Stable options: a new resolver identity would cancel the attempt.
    const stable: SynologyFileConnectionOptions = {
      instanceId: "nas",
      initialConfig: {
        host: "nas.test",
        port: 5001,
        useHttps: true,
        username: "",
        password: "",
      },
      resolveCredentials,
      ...options,
    };
    return renderHook(() => useSynologyFileConnection(true, stable));
  };
  const script = (...outcomes: unknown[]) => {
    const queue = [...outcomes];
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "syn_fs_session_health")
        return {
          status: "connected",
          lastVerifiedAt: "",
          consecutiveFailures: 0,
          message: null,
        };
      if (command !== "syn_fs_connect") return undefined;
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    });
  };
  const connected = (extra: Args = {}) => ({
    status: "connected",
    sessionId: "receipt",
    message: "ok",
    ...extra,
  });
  beforeEach(() => {
    resolveCredentials.mockClear();
    resolveOtp.mockClear();
  });

  it("asks DSM to trust the device on an automatic vault-code sign-in when the preference is on, storing it after the attempt", async () => {
    const trust = adapter();
    script({ status: "otp_required" }, connected({ trustedDevice: device }));
    const { result } = vaultHook({
      resolveOtp,
      deviceTrust: trust,
      trustDevice: true,
    });
    await act(() => result.current.connect());
    await waitFor(() => expect(trust.store).toHaveBeenCalledOnce());
    expect(result.current.connectionStatus).toBe("connected");
    expect(resolveOtp).toHaveBeenCalledOnce();
    const [initial, withCode] = connectCalls();
    for (const key of ["trustDevice", "deviceId", "deviceName"])
      expect(initial).not.toHaveProperty(key);
    expect(withCode).toMatchObject({ otpCode: "123456", trustDevice: true });
    expect(withCode).not.toHaveProperty("deviceId");
    expect(trust.store).toHaveBeenCalledWith(
      expect.any(Function),
      "admin",
      device,
    );
    expect(trust.store.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.invoke.mock.invocationCallOrder[1],
    );
    expect(result.current.deviceTrust).toMatchObject({
      remembered: true,
      notice: SYNOLOGY_TRUSTED_DEVICE_SAVED,
    });
    expect(JSON.stringify(result.current)).not.toContain(DEVICE_ID);
  });

  it("signs in with a saved device without a code, authenticator or new trust request", async () => {
    const trust = adapter(device);
    script(connected());
    const { result } = vaultHook({
      resolveOtp,
      deviceTrust: trust,
      trustDevice: true,
    });
    await act(() => result.current.connect());
    expect(trust.resolve).toHaveBeenCalledWith(expect.any(Function), "admin");
    expect(connectCalls()).toEqual([
      expect.objectContaining({
        otpCode: null,
        deviceId: DEVICE_ID,
        deviceName: DEVICE_NAME,
      }),
    ]);
    expect(connectCalls()[0]).not.toHaveProperty("trustDevice");
    expect(resolveOtp).not.toHaveBeenCalled();
    expect(result.current.challenge).toBeNull();
    expect(result.current.deviceTrust).toMatchObject({
      remembered: true,
      notice: null,
    });
    expect(trust.store).not.toHaveBeenCalled();
    expect(trust.forget).not.toHaveBeenCalled();
    expect(JSON.stringify(result.current)).not.toContain(DEVICE_ID);
  });

  it("uses the vault code once after DSM rejects the saved device and forgets it only after the attempt settles", async () => {
    const trust = adapter(device);
    let connectsAtForget = 0;
    trust.forget.mockImplementation(async (assertCurrent) => {
      assertCurrent();
      connectsAtForget = connectCalls().length;
      return { status: "saved" };
    });
    script(
      { status: "otp_required", trustedDeviceRejected: true },
      connected(),
    );
    const { result } = vaultHook({ resolveOtp, deviceTrust: trust });
    await act(() => result.current.connect());
    await waitFor(() => expect(trust.forget).toHaveBeenCalledOnce());
    expect(connectsAtForget).toBe(2);
    expect(trust.forget).toHaveBeenCalledWith(expect.any(Function), "admin");
    expect(resolveOtp).toHaveBeenCalledOnce();
    const [withDevice, withCode] = connectCalls();
    expect(withDevice).toMatchObject({ deviceId: DEVICE_ID });
    expect(withCode).toMatchObject({ otpCode: "123456" });
    for (const key of ["trustDevice", "deviceId", "deviceName"])
      expect(withCode).not.toHaveProperty(key);
    expect(result.current.connectionStatus).toBe("connected");
    expect(result.current.deviceTrust).toMatchObject({
      remembered: false,
      notice:
        "This NAS no longer accepted the saved trusted device, so it was forgotten.",
    });
    expect(trust.store).not.toHaveBeenCalled();
  });

  it("waits for a pending forget before the typed code resolves vault credentials again", async () => {
    const trust = adapter(device);
    let finishForget!: (write: SynologyDeviceTrustWrite) => void;
    trust.forget.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishForget = resolve;
        }),
    );
    script(
      { status: "otp_required", trustedDeviceMismatch: true },
      connected(),
    );
    const { result } = vaultHook({ deviceTrust: trust });
    await act(() => result.current.connect());
    expect(result.current.challenge).toMatchObject({
      status: "otp_required",
      trustedDeviceMismatch: true,
    });
    expect(result.current.deviceTrust.notice).toBe(
      SYNOLOGY_TRUSTED_DEVICE_MISMATCH,
    );
    await waitFor(() => expect(trust.forget).toHaveBeenCalledOnce());
    act(() => result.current.setOtpCode("123456"));
    let submitted!: Promise<void>;
    await act(async () => {
      submitted = result.current.submitOtp();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(resolveCredentials).toHaveBeenCalledOnce();
    expect(connectCalls()).toHaveLength(1);
    await act(async () => {
      finishForget({ status: "saved" });
      await submitted;
    });
    expect(resolveCredentials).toHaveBeenCalledTimes(2);
    expect(result.current.connectionStatus).toBe("connected");
    expect(connectCalls()[1]).not.toHaveProperty("deviceId");
  });

  it.each([
    [
      "a vault conflict",
      async () =>
        ({
          status: "not-saved",
          message: DEVICE_TRUST_NOT_REMEMBERED_MESSAGE,
        }) as const,
      DEVICE_TRUST_NOT_REMEMBERED_MESSAGE,
    ],
    [
      "a thrown save failure",
      async (): Promise<SynologyDeviceTrustWrite> => {
        throw new Error(`save failed for ${DEVICE_ID}`);
      },
      "This device was not remembered. The next sign-in will ask for a code.",
    ],
  ])(
    "stays signed in after %s and shows a safe message",
    async (_name, store, message) => {
      const trust = adapter();
      trust.store.mockImplementation(store);
      script({ status: "otp_required" }, connected({ trustedDevice: device }));
      const { result } = vaultHook({ deviceTrust: trust });
      await act(() => result.current.connect());
      act(() => {
        result.current.deviceTrust.setEnabled(true);
        result.current.setOtpCode("123456");
      });
      await act(() => result.current.submitOtp());
      await waitFor(() =>
        expect(result.current.deviceTrust.notice).toBe(message),
      );
      expect(result.current.connectionStatus).toBe("connected");
      expect(result.current.deviceTrust.remembered).toBe(false);
      expect(JSON.stringify(result.current)).not.toContain(DEVICE_ID);
    },
  );

  it("keeps the saved device when forgetting a rejected one fails", async () => {
    const trust = adapter(device);
    trust.forget.mockResolvedValue({
      status: "not-saved",
      message: DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE,
    });
    script({ status: "otp_required", trustedDeviceRejected: true });
    const { result } = vaultHook({ deviceTrust: trust });
    await act(() => result.current.connect());
    await waitFor(() =>
      expect(result.current.deviceTrust.notice).toBe(
        `${SYNOLOGY_TRUSTED_DEVICE_REJECTED} ${DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE}`,
      ),
    );
    expect(result.current.deviceTrust.remembered).toBe(true);
    expect(result.current.challenge?.status).toBe("otp_required");
  });

  it("ignores a trusted device DSM returns without opt-in or in an unsafe shape", async () => {
    const trust = adapter();
    script({ status: "otp_required" }, connected({ trustedDevice: device }));
    const plain = vaultHook({ deviceTrust: trust });
    await act(() => plain.result.current.connect());
    act(() => plain.result.current.setOtpCode("123456"));
    await act(() => plain.result.current.submitOtp());
    expect(plain.result.current.connectionStatus).toBe("connected");
    expect(connectCalls()[1]).not.toHaveProperty("trustDevice");
    expect(plain.result.current.deviceTrust.notice).toBeNull();
    plain.unmount();

    for (const unsafe of [
      { deviceName: "   ", deviceId: DEVICE_ID },
      { deviceName: DEVICE_NAME, deviceId: "d".repeat(1025) },
      { deviceName: "", deviceId: DEVICE_ID },
      { deviceName: "n".repeat(65), deviceId: DEVICE_ID },
    ]) {
      mocks.invoke.mockReset();
      script({ status: "otp_required" }, connected({ trustedDevice: unsafe }));
      const hook = vaultHook({ deviceTrust: trust, trustDevice: true });
      await act(() => hook.result.current.connect());
      act(() => hook.result.current.setOtpCode("123456"));
      await act(() => hook.result.current.submitOtp());
      expect(connectCalls()[1]).toMatchObject({ trustDevice: true });
      expect(hook.result.current.connectionStatus).toBe("connected");
      expect(hook.result.current.deviceTrust.notice).toBe(
        SYNOLOGY_TRUSTED_DEVICE_NOT_ISSUED,
      );
      hook.unmount();
    }
    // Control characters in an id never get past the IPC boundary, and its
    // error names the field, not the value.
    mocks.invoke.mockReset();
    script(
      { status: "otp_required" },
      connected({
        trustedDevice: { deviceName: DEVICE_NAME, deviceId: `${DEVICE_ID}\n` },
      }),
    );
    const boundary = vaultHook({ deviceTrust: trust, trustDevice: true });
    await act(() => boundary.result.current.connect());
    act(() => boundary.result.current.setOtpCode("123456"));
    await act(() => boundary.result.current.submitOtp());
    expect(boundary.result.current.connectionStatus).toBe("error");
    expect(boundary.result.current.connectionError).not.toContain(DEVICE_ID);
    expect(trust.store).not.toHaveBeenCalled();
  });

  it("falls back to the normal code prompt when the saved device can't be read", async () => {
    const trust = adapter();
    trust.resolve.mockRejectedValue(new Error("vault unavailable"));
    script({ status: "otp_required" });
    const { result } = vaultHook({ deviceTrust: trust });
    await act(() => result.current.connect());
    expect(result.current.challenge?.status).toBe("otp_required");
    expect(result.current.connectionError).toBeNull();
    expect(connectCalls()[0]).not.toHaveProperty("deviceId");
    expect(result.current.deviceTrust.notice).toBeNull();
  });

  it("redacts a sent device id from sign-in errors", async () => {
    const trust = adapter(device);
    script(new Error(`native login failed near ${DEVICE_ID}`));
    const { result } = vaultHook({ deviceTrust: trust });
    await act(() => result.current.connect());
    expect(result.current.connectionStatus).toBe("error");
    expect(result.current.connectionError).toContain("[REDACTED]");
    expect(result.current.connectionError).not.toContain(DEVICE_ID);
    expect(JSON.stringify(result.current)).not.toContain(DEVICE_ID);
  });

  it("forgets on request for the signed-in account and reports a failed forget", async () => {
    const trust = adapter(device);
    script(connected());
    const { result } = vaultHook({ deviceTrust: trust });
    await act(() => result.current.connect());
    expect(result.current.deviceTrust.remembered).toBe(true);
    trust.forget.mockResolvedValueOnce({
      status: "not-saved",
      message: DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE,
    });
    await act(() => result.current.deviceTrust.forget());
    expect(result.current.deviceTrust).toMatchObject({
      remembered: true,
      forgetting: false,
      notice: DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE,
    });
    await act(() => result.current.deviceTrust.forget());
    expect(trust.forget).toHaveBeenLastCalledWith(
      expect.any(Function),
      "admin",
    );
    expect(result.current.deviceTrust).toMatchObject({
      remembered: false,
      forgetting: false,
      notice: SYNOLOGY_TRUSTED_DEVICE_FORGOTTEN,
    });
    expect(result.current.connectionStatus).toBe("connected");
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "syn_fs_disconnect",
      ),
    ).toBe(false);
  });

  it("resets the checkbox to the saved preference and has no trust controls without vault storage", async () => {
    const trust = adapter();
    script({ status: "otp_required" });
    const vault = vaultHook({ deviceTrust: trust, trustDevice: true });
    await act(() => vault.result.current.connect());
    expect(vault.result.current.deviceTrust.enabled).toBe(true);
    act(() => vault.result.current.deviceTrust.setEnabled(false));
    expect(vault.result.current.deviceTrust.enabled).toBe(false);
    act(() => vault.result.current.cancelChallenge());
    expect(vault.result.current.deviceTrust.enabled).toBe(true);
    vault.unmount();

    mocks.invoke.mockReset();
    script({ status: "otp_required" }, connected({ trustedDevice: device }));
    const local = renderHook(() =>
      useSynologyFileConnection(true, { trustDevice: true }),
    );
    act(() => {
      local.result.current.setHost("nas.example.test");
      local.result.current.setUsername("alice");
      local.result.current.setPassword("private-password");
    });
    await act(() => local.result.current.connect());
    expect(local.result.current.deviceTrust).toMatchObject({
      available: false,
      unavailableReason: null,
      enabled: false,
    });
    act(() => local.result.current.deviceTrust.setEnabled(true));
    expect(local.result.current.deviceTrust.enabled).toBe(false);
    act(() => local.result.current.setOtpCode("123456"));
    await act(() => local.result.current.submitOtp());
    expect(local.result.current.connectionStatus).toBe("connected");
    for (const args of connectCalls())
      for (const key of ["trustDevice", "deviceId", "deviceName"])
        expect(args).not.toHaveProperty(key);
    expect(local.result.current.deviceTrust.remembered).toBe(false);
  });
});
