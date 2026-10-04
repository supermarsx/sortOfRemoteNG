import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RemoteDatabasesSection from "../../src/components/SettingsDialog/sections/cloudSync/RemoteDatabasesSection";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";
import type { DatabaseProtectionCapabilities } from "../../src/types/encryption/databaseProtection";
import type { RemoteDatabaseCatalog } from "../../src/utils/services/cloudSyncRemoteDatabases";
import { FullDatabaseRestoreIncompleteError } from "../../src/utils/connection/fullDatabaseArchive";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  pull: vi.fn(),
  capabilities: vi.fn(),
  validate: vi.fn(),
  update: vi.fn(),
  policy: undefined as unknown,
}));
vi.mock(
  "../../src/utils/services/cloudSyncRemoteDatabases",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    discoverRemoteDatabases: mocks.discover,
    pullRemoteDatabase: mocks.pull,
  }),
);
vi.mock("../../src/utils/connection/databaseProtection", () => ({
  databaseProtection: { capabilities: mocks.capabilities },
}));
vi.mock("../../src/utils/security/passwordPolicy", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  validateNewPassword: mocks.validate,
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { passwordPolicy: mocks.policy } }),
}));

const target: CloudSyncTarget = {
  id: "work",
  label: "Work",
  enabled: true,
  provider: "webdav",
  webdav: {
    serverUrl: "https://sync.example.test",
    username: "owner",
    password: "remote-secret",
    folderPath: "/sync",
    authMethod: "basic",
  },
};
const config = (): CloudSyncConfig => ({
  ...defaultCloudSyncConfig,
  enabled: true,
  selectedItems: [],
  encryptBeforeSync: true,
  syncEncryptionPassword: "cloud-password-only",
  syncTargets: [structuredClone(target)],
});
const catalog = (): RemoteDatabaseCatalog => ({
  targetId: "work",
  requestIdentity: Symbol("work"),
  revision: "revision-1",
  snapshotHash: "hash-1",
  modifiedAt: 1791000000000,
  databases: [
    {
      id: "remote-db",
      label: "Remote work",
      nameAvailable: true,
      bytes: 4096,
      existsLocally: false,
    },
    {
      id: "local-db",
      label: "Local work",
      nameAvailable: true,
      bytes: 2048,
      existsLocally: true,
    },
  ],
});
const capabilities = (vault = false): DatabaseProtectionCapabilities => ({
  schemaVersion: 1,
  ciphers: [{ id: "aes-256-gcm", available: true }],
  protectors: [
    {
      id: "password",
      available: true,
      deviceBound: false,
      requiresUserPresence: false,
    },
    {
      id: "os-vault",
      available: vault,
      deviceBound: true,
      requiresUserPresence: false,
    },
  ],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function Harness({
  cloudSync = config(),
  busy = false,
}: {
  cloudSync?: CloudSyncConfig;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState(cloudSync.selectedItems);
  const mgr = {
    cloudSync: { ...cloudSync, selectedItems: selected },
    syncTargets: cloudSync.syncTargets ?? [],
    isBusy: busy,
    updateCloudSync: (updates: Partial<CloudSyncConfig>) => {
      mocks.update(updates);
      if (updates.selectedItems) setSelected(updates.selectedItems);
    },
  } as Mgr;
  return (
    <>
      <RemoteDatabasesSection mgr={mgr} />
      <button
        onClick={() => setSelected([...(selected ?? []), "app:settings"])}
      >
        Select appearance separately
      </button>
      <output aria-label="Current sync selection">{selected?.join(",")}</output>
    </>
  );
}
const refresh = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh remote databases" }),
  );
async function prepare() {
  refresh();
  fireEvent.click(
    await screen.findByRole("button", { name: "Prepare pull for Remote work" }),
  );
  await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled());
  return screen.getByRole("form", { name: "Pull Remote work" });
}
function fillPassword(value = "new-local-password") {
  fireEvent.change(screen.getByLabelText("Local unlock password"), {
    target: { value },
  });
  fireEvent.change(screen.getByLabelText("Confirm local unlock password"), {
    target: { value },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.policy = undefined;
  mocks.discover.mockResolvedValue(catalog());
  mocks.pull.mockResolvedValue({ id: "remote-db", name: "Restored work" });
  mocks.capabilities.mockResolvedValue(capabilities());
  mocks.validate.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("remote cloud databases settings", () => {
  it("allows manual discovery and pull while automatic cloud sync is off", async () => {
    render(<Harness cloudSync={{ ...config(), enabled: false }} />);
    expect(
      screen.getByRole("region", { name: "Remote databases" }),
    ).toHaveAttribute("data-setting-key", "cloudSync.remoteDatabases");
    expect(screen.getByText(/Automatic cloud sync is off/)).toBeInTheDocument();
    await prepare();
    fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Pull database" }));
    await screen.findByText(/Pulled Restored work/);
    expect(mocks.pull).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ enabled: false }),
      expect.anything(),
      "remote-db",
      expect.anything(),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      selectedItems: ["database:remote-db"],
    });
  });

  it("keeps the section anchor rendered without configured targets", () => {
    render(
      <RemoteDatabasesSection
        mgr={
          {
            cloudSync: config(),
            updateCloudSync: mocks.update,
            isBusy: false,
          } as unknown as Mgr
        }
      />,
    );
    expect(
      screen.getByRole("region", { name: "Remote databases" }),
    ).toHaveAttribute("data-setting-key", "cloudSync.remoteDatabases");
    expect(
      screen.getByText(/Add and enable a sync target/),
    ).toBeInTheDocument();
  });

  it("discovers manually with no selected local artifacts, without changing selection", async () => {
    render(<Harness />);
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Refresh remote databases" }),
    ).toBeEnabled();
    refresh();
    expect(
      await screen.findByRole("list", { name: "Remote databases on Work" }),
    ).toBeInTheDocument();
    expect(mocks.discover).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ selectedItems: [] }),
      expect.any(Function),
    );
    expect(
      screen.getByText(/remote-db · 4.0 KiB · Not on this device/),
    ).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it("disables existing databases and uses the app's themed input/select/password controls", async () => {
    render(<Harness />);
    const form = await prepare();
    expect(
      screen.getByRole("button", { name: "Prepare pull for Local work" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/local-db.*Already on this device/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Remote database sync target" }),
    ).toHaveClass("sor-settings-select");
    expect(
      screen.getByRole("combobox", { name: "Local unlock protection" }),
    ).toHaveClass("sor-settings-select");
    for (const label of [
      "Local database name",
      "Local unlock password",
      "Confirm local unlock password",
    ])
      expect(within(form).getByLabelText(label)).toHaveClass(
        "sor-settings-input",
        "w-full",
      );
    const password = screen.getByLabelText("Local unlock password");
    expect(password).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Local database name")).toHaveAttribute(
      "maxlength",
      "256",
    );
    expect(password).toHaveValue("");
    expect(password.parentElement).toHaveClass("relative", "w-full");
    expect(password).toHaveStyle({ paddingRight: "2.25rem" });
    expect(
      screen.getByRole("button", { name: "Pull database" }),
    ).toBeDisabled();
  });

  it("pulls under the same ID, applies only local protection, and adds to the latest selection", async () => {
    const pending = deferred<{ id: string; name: string }>();
    mocks.pull.mockReturnValue(pending.promise);
    const initial = config();
    const view = render(<Harness cloudSync={initial} />);
    await prepare();
    fillPassword();
    fireEvent.change(screen.getByLabelText("Local database name"), {
      target: { value: "Restored work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pull database" }));
    await waitFor(() => expect(mocks.pull).toHaveBeenCalledOnce());
    const options = mocks.pull.mock.calls[0][4];
    expect(mocks.validate).toHaveBeenCalledWith(
      "new-local-password",
      "database",
    );
    expect(mocks.pull).toHaveBeenCalledWith(
      target,
      expect.objectContaining({
        syncEncryptionPassword: "cloud-password-only",
      }),
      expect.objectContaining({ revision: "revision-1" }),
      "remote-db",
      expect.objectContaining({
        name: "Restored work",
        protectionTarget: {
          dataCipher: "aes-256-gcm",
          keepSlotIds: [],
          newSlots: [
            {
              type: "password",
              label: "Local unlock password",
              password: "new-local-password",
            },
          ],
        },
      }),
    );
    // Our own global activity must not cancel a successfully running operation.
    view.rerender(
      <Harness cloudSync={{ ...initial, lastSyncTime: Date.now() }} busy />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select appearance separately" }),
    );
    expect(() => options.assertCurrent()).not.toThrow();
    await act(async () =>
      pending.resolve({ id: "remote-db", name: "Restored work" }),
    );
    expect(mocks.update).toHaveBeenLastCalledWith({
      selectedItems: ["app:settings", "database:remote-db"],
    });
    expect(
      screen.getByText(/your current database was not changed/),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Local unlock password"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Refresh to pull another database/),
    ).toBeInTheDocument();
  });

  it("supports pulling without opting into ongoing sync", async () => {
    render(<Harness />);
    await prepare();
    fillPassword();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Add to What to Sync after pulling",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pull database" }));
    await screen.findByText(/Pulled Restored work/);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires a local display name for older ID-only snapshots", async () => {
    const result = catalog();
    result.databases[0].nameAvailable = false;
    mocks.discover.mockResolvedValue(result);
    render(<Harness />);
    await prepare();
    fillPassword();
    expect(
      screen.getByText(/Older snapshots store the database ID/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Local database name")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Pull database" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Local database name"), {
      target: { value: "Recovered archive" },
    });
    expect(screen.getByRole("button", { name: "Pull database" })).toBeEnabled();
  });

  it("enforces confirmation and configured password policy before pulling", async () => {
    mocks.policy = {
      version: 1,
      enabled: true,
      minLength: 16,
      requireUppercase: true,
      requireLowercase: false,
      requireDigit: false,
      requireSymbol: false,
    };
    render(<Harness />);
    const form = await prepare();
    fillPassword("lowercase-password");
    expect(screen.getByText(/Include an uppercase letter/)).toBeInTheDocument();
    fireEvent.submit(form);
    expect(mocks.pull).not.toHaveBeenCalled();
    fillPassword("Uppercase-password");
    fireEvent.change(screen.getByLabelText("Confirm local unlock password"), {
      target: { value: "wrong" },
    });
    expect(
      screen.getByRole("button", { name: "Pull database" }),
    ).toBeDisabled();
  });

  it("does not pull when authoritative password validation fails", async () => {
    mocks.validate.mockRejectedValue(new Error("sensitive-policy-detail"));
    render(<Harness />);
    await prepare();
    fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Pull database" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pull was started",
    );
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/sensitive-policy-detail/),
    ).not.toBeInTheDocument();
  });

  it("offers available OS vault protection only after device-bound acknowledgement", async () => {
    mocks.capabilities.mockResolvedValue(capabilities(true));
    render(<Harness />);
    await prepare();
    fillPassword();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Local unlock protection" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "OS vault (this device)" }),
    );
    expect(
      screen.queryByLabelText("Local unlock password"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pull database" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I understand this local copy/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pull database" }));
    await screen.findByText(/Pulled Restored work/);
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.pull.mock.calls[0][4]).toEqual(
      expect.objectContaining({
        confirmDeviceBoundOnly: true,
        protectionTarget: {
          dataCipher: "aes-256-gcm",
          keepSlotIds: [],
          newSlots: [{ type: "os-vault", label: "This device's OS vault" }],
        },
      }),
    );
  });

  it("disables unavailable OS vault protection and allows retry after capability failure", async () => {
    mocks.capabilities.mockRejectedValueOnce(new Error("native-secret"));
    render(<Harness />);
    await prepare();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not check local protection",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry protection check" }),
    );
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalledTimes(2));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Local unlock protection" }),
    );
    expect(
      screen.getByRole("option", {
        name: "OS vault (unavailable on this device)",
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("clears secrets when cancelling and does not submit duplicate pulls", async () => {
    render(<Harness />);
    await prepare();
    fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Cancel pull" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare pull for Remote work" }),
    );
    expect(screen.getByLabelText("Local unlock password")).toHaveValue("");
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalledTimes(2));
    fillPassword();
    const pending = deferred<void>();
    mocks.validate.mockReturnValue(pending.promise);
    const form = screen.getByRole("form", { name: "Pull Remote work" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await act(async () => pending.resolve());
    await waitFor(() => expect(mocks.pull).toHaveBeenCalledOnce());
  });

  it.each(["target", "cloud-password", "size", "disabled", "removed"])(
    "discards pending discovery when %s changes",
    async (change) => {
      const pending = deferred<RemoteDatabaseCatalog>();
      mocks.discover.mockReturnValue(pending.promise);
      const initial = config();
      const view = render(<Harness cloudSync={initial} />);
      refresh();
      const assertCurrent = mocks.discover.mock.calls[0][2];
      const edited = structuredClone(initial);
      if (change === "target")
        edited.syncTargets![0].webdav!.serverUrl = "https://other.example.test";
      if (change === "cloud-password")
        edited.syncEncryptionPassword = "changed";
      if (change === "size") edited.maxFileSizeMB = 3;
      if (change === "disabled") edited.enabled = false;
      if (change === "removed") edited.syncTargets = [];
      view.rerender(<Harness cloudSync={edited} />);
      expect(() => assertCurrent()).toThrow();
      await act(async () => pending.resolve(catalog()));
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("ignores a pull finishing after the target is edited or removed", async () => {
    const pending = deferred<{ id: string; name: string }>();
    mocks.pull.mockReturnValue(pending.promise);
    const initial = config();
    const view = render(<Harness cloudSync={initial} />);
    await prepare();
    fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Pull database" }));
    await waitFor(() => expect(mocks.pull).toHaveBeenCalledOnce());
    const options = mocks.pull.mock.calls[0][4];
    view.rerender(<Harness cloudSync={{ ...initial, syncTargets: [] }} />);
    expect(() => options.assertCurrent()).toThrow();
    await act(async () =>
      pending.resolve({ id: "remote-db", name: "Restored work" }),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.queryByText(/Pulled Restored work/)).not.toBeInTheDocument();
  });

  it("invalidates ownership on unmount before password validation completes", async () => {
    const pending = deferred<void>();
    mocks.validate.mockReturnValue(pending.promise);
    const view = render(<Harness />);
    await prepare();
    fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Pull database" }));
    view.unmount();
    await act(async () => pending.resolve());
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires a refreshed catalog after failure and never displays raw error secrets", async () => {
    mocks.pull.mockRejectedValue(
      new Error("password=secret https://sensitive.test/token"),
    );
    render(<Harness />);
    await prepare();
    fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Pull database" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A local copy may have been created",
    );
    expect(screen.queryByText(/password=secret/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Local unlock password"),
    ).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("preserves app-authored partial restore details and the created database ID", async () => {
    mocks.pull.mockRejectedValue(
      new FullDatabaseRestoreIncompleteError("remote-db"),
    );
    render(<Harness />);
    await prepare();
    fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Pull database" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The protected database was created (remote-db), but trust restoration did not complete",
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([null, "revision-1"])(
    "distinguishes an empty target from a snapshot without databases (%s)",
    async (revision) => {
      mocks.discover.mockResolvedValue({
        ...catalog(),
        databases: [],
        revision,
        modifiedAt: null,
      });
      render(<Harness />);
      refresh();
      expect(
        await screen.findByText(
          revision
            ? "This remote snapshot contains no databases."
            : "No cloud snapshot was found on this target yet.",
        ),
      ).toBeInTheDocument();
    },
  );

  it("blocks new operations during unrelated global sync activity", () => {
    render(<Harness busy />);
    expect(
      screen.getByRole("button", { name: "Refresh remote databases" }),
    ).toBeDisabled();
    refresh();
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});
