import { useState, type ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SyncItemsGrid from "../../src/components/SettingsDialog/sections/cloudSync/SyncItemsGrid";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import type { ManagedDatabaseUnlockDialog } from "../../src/components/encryption/DatabaseUnlockDialog";
import { ToastContext } from "../../src/contexts/ToastContext";
import type {
  DatabaseAccessState,
  DatabaseProtectionStatus,
} from "../../src/types/encryption/databaseProtection";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";
import type { CloudSyncItem } from "../../src/utils/services/cloudSyncPayload";

type DialogProps = ComponentProps<typeof ManagedDatabaseUnlockDialog>;
const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  protection: vi.fn(),
  selectDatabase: vi.fn(),
  unlock: vi.fn(),
  update: vi.fn(),
  syncNow: vi.fn(),
  syncTarget: vi.fn(),
  dialog: vi.fn<(props: DialogProps) => void>(),
  realDialog: false,
  toastLoading: vi.fn(),
  toastUpdate: vi.fn(),
  accessListeners: new Set<(state: DatabaseAccessState) => void>(),
}));

vi.mock("../../src/utils/services/cloudSyncPayload", () => ({
  discoverCloudSyncItems: mocks.discover,
}));
vi.mock("../../src/utils/connection/databaseManager", () => {
  const subscribeAccess = (listener: (state: DatabaseAccessState) => void) => {
    mocks.accessListeners.add(listener);
    return () => mocks.accessListeners.delete(listener);
  };
  return {
    DatabaseManager: {
      getInstance: () => ({
        getDatabaseProtectionStatus: mocks.protection,
        selectDatabase: mocks.selectDatabase,
        unlockManagedDatabase: mocks.unlock,
        onDatabaseAccessChange: subscribeAccess,
      }),
    },
    onCurrentDatabaseChange: () => () => {},
    onDatabaseAccessChange: subscribeAccess,
  };
});
// Most inventory tests drive callbacks directly; toast regressions also mount
// the real dialog so its intentionally invisible OS-vault path is exercised.
vi.mock(
  "../../src/components/encryption/DatabaseUnlockDialog",
  async (actual) => {
    const real =
      await actual<
        typeof import("../../src/components/encryption/DatabaseUnlockDialog")
      >();
    return {
      ManagedDatabaseUnlockDialog: (props: DialogProps) => {
        mocks.dialog(props);
        if (mocks.realDialog)
          return <real.ManagedDatabaseUnlockDialog {...props} />;
        return (
          <div role="dialog" aria-label={`Unlock ${props.databaseName}`}>
            <button onClick={props.onClose}>Cancel database unlock</button>
            <button onClick={() => void props.onUnlockComplete?.()}>
              Complete database unlock
            </button>
          </div>
        );
      },
    };
  },
);

const toastContext = {
  toast: {
    loading: mocks.toastLoading,
    update: mocks.toastUpdate,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  },
  removeAll: vi.fn(),
};

const protectedStatus: DatabaseProtectionStatus = {
  kind: "managed",
  securityRevision: "work-revision-1",
  dataCipher: "aes-256-gcm",
  unlocked: false,
  slots: [
    {
      id: "work-password",
      type: "password",
      label: "Recovery password",
      deviceBound: false,
    },
  ],
};
const locked: CloudSyncItem = {
  id: "database:work-id",
  label: "Work archive",
  kind: "database",
  available: false,
  unlockDatabaseId: "work-id",
  unavailableReason: "Unlock this database before syncing.",
};
const other: CloudSyncItem = {
  ...locked,
  id: "database:other-id",
  label: "Other archive",
  unlockDatabaseId: "other-id",
};
const toggleLabel = "Automatically unlock OS-vault databases for sync";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function Harness({
  initial = {},
  busy = false,
}: {
  initial?: Partial<CloudSyncConfig>;
  busy?: boolean;
}) {
  const [cloudSync, setCloudSync] = useState<CloudSyncConfig>({
    ...defaultCloudSyncConfig,
    selectedItems: [other.id],
    ...initial,
  });
  return (
    <ToastContext.Provider value={toastContext}>
      <SyncItemsGrid
        mgr={
          {
            cloudSync,
            isBusy: busy,
            handleSyncNow: mocks.syncNow,
            handleSyncTarget: mocks.syncTarget,
            updateCloudSync: (patch: Partial<CloudSyncConfig>) => {
              mocks.update(patch);
              setCloudSync((current) => ({ ...current, ...patch }));
            },
          } as unknown as Mgr
        }
      />
    </ToastContext.Provider>
  );
}

function unlockButton(label = locked.label) {
  return screen.getByRole("button", { name: `Unlock database ${label}` });
}

function autoUnlockToggle() {
  // Shared Toggle includes its description and tooltip in the accessible name.
  expect(screen.getByText(toggleLabel, { exact: true })).toBeInTheDocument();
  return screen.getByRole("checkbox", { name: new RegExp(`^${toggleLabel}`) });
}

function emitAccess(patch: Partial<DatabaseAccessState> = {}) {
  const state: DatabaseAccessState = {
    databaseId: "work-id",
    status: "ready",
    reason: "unlocked",
    securityRevision: protectedStatus.securityRevision,
    accessEpoch: "work-access-2",
    ...patch,
  };
  act(() => mocks.accessListeners.forEach((listener) => listener(state)));
}

async function ready() {
  await screen.findByRole("checkbox", { name: /Work archive/ });
  await waitFor(() =>
    expect(screen.queryByText("Loading inventory…")).not.toBeInTheDocument(),
  );
}

function expectNoSyncOrSelectionChange() {
  expect(mocks.selectDatabase).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.syncNow).not.toHaveBeenCalled();
  expect(mocks.syncTarget).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.realDialog = false;
  mocks.toastLoading.mockReturnValue("unlock-toast");
  mocks.accessListeners.clear();
  mocks.discover.mockResolvedValue([locked, other]);
  mocks.protection.mockResolvedValue(protectedStatus);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("cloud sync database unlock integration", () => {
  it("uses one toast for real pending OS-vault progress and success without inline progress", async () => {
    mocks.realDialog = true;
    const pending = deferred<void>();
    mocks.unlock.mockReturnValue(pending.promise);
    mocks.protection.mockResolvedValue({
      ...protectedStatus,
      slots: [
        {
          id: "os-slot",
          type: "os-vault",
          label: "This device",
          deviceBound: true,
        },
      ],
    });
    render(<Harness />);
    await ready();
    fireEvent.click(unlockButton());
    await waitFor(() => expect(mocks.unlock).toHaveBeenCalledOnce());
    expect(mocks.dialog.mock.lastCall?.[0].onUnlockProgress).toEqual(
      expect.any(Function),
    );
    expect(mocks.toastLoading).toHaveBeenCalledOnce();
    expect(mocks.toastUpdate).toHaveBeenLastCalledWith("unlock-toast", {
      type: "loading",
      message: "Unlocking “Work archive”…",
      duration: 0,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /Unlocking|Preparing to unlock/,
    );
    expect(unlockButton()).toBeDisabled();
    mocks.discover.mockResolvedValue([{ ...locked, available: true }, other]);
    await act(async () => pending.resolve());
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /Work archive/ }),
      ).toBeEnabled(),
    );
    expect(mocks.toastUpdate).toHaveBeenLastCalledWith("unlock-toast", {
      type: "success",
      message: "Unlocked “Work archive” for cloud sync.",
      duration: 4000,
    });
    expect(mocks.toastLoading).toHaveBeenCalledOnce();
    expectNoSyncOrSelectionChange();
  });

  it.each(["unmount", "global lock", "sync busy"] as const)(
    "settles the real pending unlock toast on %s and ignores late completion",
    async (cancel) => {
      mocks.realDialog = true;
      const pending = deferred<void>();
      mocks.unlock.mockReturnValue(pending.promise);
      mocks.protection.mockResolvedValue({
        ...protectedStatus,
        slots: [
          {
            id: "os-slot",
            type: "os-vault",
            label: "This device",
            deviceBound: true,
          },
        ],
      });
      const view = render(<Harness />);
      await ready();
      fireEvent.click(unlockButton());
      await waitFor(() => expect(mocks.unlock).toHaveBeenCalledOnce());
      const callbacks = mocks.dialog.mock.lastCall![0];
      if (cancel === "unmount") view.unmount();
      else if (cancel === "global lock")
        emitAccess({ status: "suspended", reason: "global-lock" });
      else view.rerender(<Harness busy />);
      expect(mocks.toastUpdate).toHaveBeenLastCalledWith("unlock-toast", {
        type: "info",
        message: "Unlocking “Work archive” was cancelled.",
        duration: 4000,
      });
      const updates = mocks.toastUpdate.mock.calls.length;
      await act(async () => {
        pending.resolve();
        callbacks.onUnlockProgress?.("unlocking");
        await callbacks.onUnlockComplete?.();
      });
      expect(mocks.toastUpdate).toHaveBeenCalledTimes(updates);
      expect(mocks.toastLoading).toHaveBeenCalledOnce();
      expectNoSyncOrSelectionChange();
    },
  );

  it("updates the same toast through failed authentication, retry, and dialog cancellation", async () => {
    render(<Harness />);
    await ready();
    fireEvent.click(unlockButton());
    await screen.findByRole("dialog");
    const progress = mocks.dialog.mock.lastCall![0].onUnlockProgress!;
    act(() => progress("failed"));
    expect(mocks.toastUpdate).toHaveBeenLastCalledWith("unlock-toast", {
      type: "error",
      message:
        "Could not unlock “Work archive”. Review the unlock dialog and retry.",
      duration: 0,
    });
    act(() => progress("unlocking"));
    expect(mocks.toastUpdate).toHaveBeenLastCalledWith("unlock-toast", {
      type: "loading",
      message: "Unlocking “Work archive”…",
      duration: 0,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel database unlock" }),
    );
    expect(mocks.toastUpdate).toHaveBeenLastCalledWith("unlock-toast", {
      type: "info",
      message: "Unlocking “Work archive” was cancelled.",
      duration: 4000,
    });
    expect(mocks.toastLoading).toHaveBeenCalledOnce();
    expectNoSyncOrSelectionChange();
  });

  it("offers unlock only for unavailable inventory databases with an exact declared identity", async () => {
    mocks.discover.mockResolvedValue([
      locked,
      { ...other, available: true },
      {
        ...locked,
        id: "database:legacy",
        label: "Legacy",
        unlockDatabaseId: undefined,
      },
      { ...locked, id: "database:mismatch", label: "Mismatched identity" },
      { ...locked, id: "app:work-id", label: "Library", kind: "library" },
      { ...locked, id: "file:work-id", label: "Old file", kind: "file" },
      {
        ...locked,
        id: "database:",
        label: "Empty identity",
        unlockDatabaseId: "",
      },
    ]);
    render(<Harness initial={{ selectedItems: ["database:missing"] }} />);
    await ready();
    expect(
      screen.getAllByRole("button", { name: /^Unlock database / }),
    ).toEqual([unlockButton()]);
    expect(unlockButton()).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: /Work archive/ }),
    ).toBeDisabled();
    expect(mocks.protection).not.toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
    expectNoSyncOrSelectionChange();
  });

  it("fetches exact protection status and passes the ID, name and status to the shared dialog", async () => {
    render(<Harness />);
    await ready();
    fireEvent.click(unlockButton());
    await screen.findByRole("dialog", { name: "Unlock Work archive" });
    expect(mocks.protection).toHaveBeenCalledExactlyOnceWith("work-id");
    expect(mocks.dialog.mock.lastCall?.[0]).toMatchObject({
      databaseId: "work-id",
      databaseName: "Work archive",
    });
    expect(mocks.dialog.mock.lastCall?.[0].status).toBe(protectedStatus);
    expectNoSyncOrSelectionChange();
  });

  it("disables every unlock action during status fetch and while the dialog is open", async () => {
    const status = deferred<DatabaseProtectionStatus>();
    mocks.protection.mockReturnValueOnce(status.promise);
    render(<Harness />);
    await ready();
    fireEvent.click(unlockButton());
    for (const label of [locked.label, other.label]) {
      expect(unlockButton(label)).toBeDisabled();
      fireEvent.click(unlockButton(label));
    }
    expect(mocks.protection).toHaveBeenCalledOnce();
    await act(async () => status.resolve(protectedStatus));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    for (const label of [locked.label, other.label]) {
      expect(unlockButton(label)).toBeDisabled();
      fireEvent.click(unlockButton(label));
    }
    expect(mocks.protection).toHaveBeenCalledOnce();
  });

  it("disables unlock while inventory refresh is pending and after discovery fails", async () => {
    render(<Harness />);
    await ready();
    const inventory = deferred<CloudSyncItem[]>();
    mocks.discover.mockReturnValueOnce(inventory.promise);
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(unlockButton()).toBeDisabled();
    fireEvent.click(unlockButton());
    await act(async () =>
      inventory.reject(new Error("private inventory error")),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load/);
    expect(unlockButton()).toBeDisabled();
    fireEvent.click(unlockButton());
    expect(mocks.protection).not.toHaveBeenCalled();
    expectNoSyncOrSelectionChange();
  });

  it("disables unlock during a sync operation", async () => {
    render(<Harness busy />);
    await ready();
    expect(unlockButton()).toBeDisabled();
    expect(autoUnlockToggle()).toBeDisabled();
    fireEvent.click(unlockButton());
    act(() => autoUnlockToggle().click());
    expect(mocks.protection).not.toHaveBeenCalled();
    expectNoSyncOrSelectionChange();
  });

  it.each([false, true])(
    "completion refreshes availability and preserves selected=%s without switching or syncing",
    async (selected) => {
      render(
        <Harness
          initial={{
            selectedItems: selected ? [locked.id, other.id] : [other.id],
          }}
        />,
      );
      await ready();
      fireEvent.click(unlockButton());
      await screen.findByRole("dialog");
      mocks.discover.mockResolvedValue([
        { ...locked, available: true, unlockDatabaseId: undefined },
        other,
      ]);
      fireEvent.click(
        screen.getByRole("button", { name: "Complete database unlock" }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("checkbox", { name: /Work archive/ }),
        ).toBeEnabled(),
      );
      expect(mocks.discover).toHaveBeenCalledTimes(2);
      expect(
        (
          screen.getByRole("checkbox", {
            name: /Work archive/,
          }) as HTMLInputElement
        ).checked,
      ).toBe(selected);
      expect(
        screen.getByRole("checkbox", { name: /Other archive/ }),
      ).toBeChecked();
      expect(
        screen.queryByRole("button", { name: "Unlock database Work archive" }),
      ).not.toBeInTheDocument();
      expectNoSyncOrSelectionChange();
    },
  );

  it("cancellation closes the dialog without unlocking, selecting or syncing", async () => {
    render(<Harness />);
    await ready();
    fireEvent.click(unlockButton());
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel database unlock" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(unlockButton()).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: /Work archive/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Other archive/ }),
    ).toBeChecked();
    expect(mocks.unlock).not.toHaveBeenCalled();
    expectNoSyncOrSelectionChange();
  });

  it.each(["none", "legacy-password"] as const)(
    "does not open the managed dialog for protection kind %s",
    async (kind) => {
      mocks.protection.mockResolvedValue({ ...protectedStatus, kind });
      render(<Harness />);
      await ready();
      await act(async () => fireEvent.click(unlockButton()));
      expect(mocks.protection).toHaveBeenCalledExactlyOnceWith("work-id");
      expect(mocks.dialog).not.toHaveBeenCalled();
      expect(mocks.unlock).not.toHaveBeenCalled();
      expectNoSyncOrSelectionChange();
    },
  );

  it("shows a safe status-fetch error and permits an explicit retry", async () => {
    mocks.protection.mockRejectedValueOnce(
      new Error("secret-password at C:\\private\\vault.db"),
    );
    render(<Harness />);
    await ready();
    fireEvent.click(unlockButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not prepare this database's unlock methods. Refresh the inventory and try again; no sync was started.",
    );
    expect(document.body).not.toHaveTextContent(
      /secret-password|private\\vault/,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(unlockButton()).toBeEnabled();
    expectNoSyncOrSelectionChange();
    fireEvent.click(unlockButton());
    await screen.findByRole("dialog");
    expect(mocks.protection).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a status-fetch %s after unmount",
    async (outcome) => {
      const status = deferred<DatabaseProtectionStatus>();
      mocks.protection.mockReturnValueOnce(status.promise);
      const view = render(<Harness />);
      await ready();
      fireEvent.click(unlockButton());
      view.unmount();
      await act(async () => {
        if (outcome === "resolve") status.resolve(protectedStatus);
        else status.reject(new Error("stale secret"));
      });
      expect(mocks.dialog).not.toHaveBeenCalled();
      expect(mocks.discover).toHaveBeenCalledOnce();
      expectNoSyncOrSelectionChange();
    },
  );

  it("ignores a status response invalidated by inventory refresh", async () => {
    const status = deferred<DatabaseProtectionStatus>();
    mocks.protection.mockReturnValueOnce(status.promise);
    render(<Harness />);
    await ready();
    fireEvent.click(unlockButton());
    mocks.discover.mockResolvedValue([other]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("checkbox", { name: /Work archive/ }),
      ).not.toBeInTheDocument(),
    );
    await act(async () => status.resolve(protectedStatus));
    expect(mocks.dialog).not.toHaveBeenCalled();
    expectNoSyncOrSelectionChange();
  });

  it.each(["pending status", "open dialog"] as const)(
    "revokes %s when sync becomes busy",
    async (stage) => {
      const status = deferred<DatabaseProtectionStatus>();
      mocks.protection.mockReturnValueOnce(status.promise);
      const view = render(<Harness />);
      await ready();
      fireEvent.click(unlockButton());
      if (stage === "open dialog") {
        await act(async () => status.resolve(protectedStatus));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      }
      view.rerender(<Harness busy />);
      await ready();
      await act(async () => status.resolve(protectedStatus));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(unlockButton()).toBeDisabled();
      expectNoSyncOrSelectionChange();
    },
  );

  it.each([
    { stage: "pending status", databaseId: "work-id", reason: "locked" },
    { stage: "open dialog", databaseId: "work-id", reason: "expired" },
    { stage: "pending status", databaseId: "other-id", reason: "global-lock" },
    { stage: "open dialog", databaseId: "other-id", reason: "global-lock" },
  ] as const)(
    "revokes $stage after $reason access suspension",
    async ({ stage, databaseId, reason }) => {
      const status = deferred<DatabaseProtectionStatus>();
      mocks.protection.mockReturnValueOnce(status.promise);
      render(<Harness />);
      await ready();
      fireEvent.click(unlockButton());
      if (stage === "open dialog") {
        await act(async () => status.resolve(protectedStatus));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      }
      emitAccess({ status: "suspended", databaseId, reason });
      await act(async () => status.resolve(protectedStatus));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mocks.unlock).not.toHaveBeenCalled();
      expectNoSyncOrSelectionChange();
    },
  );

  it("refreshes unavailable rows on access changes and removes its subscription on unmount", async () => {
    const view = render(<Harness />);
    await ready();
    expect(mocks.accessListeners.size).toBeGreaterThan(0);
    mocks.discover.mockResolvedValue([
      { ...locked, available: true, unlockDatabaseId: undefined },
      other,
    ]);
    emitAccess();
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /Work archive/ }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", { name: "Unlock database Work archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Work archive/ }),
    ).not.toBeChecked();
    expectNoSyncOrSelectionChange();
    view.unmount();
    expect(mocks.accessListeners.size).toBe(0);
  });

  it("keeps the current unlock dialog open when a different database is locked", async () => {
    render(<Harness />);
    await ready();
    fireEvent.click(unlockButton());
    await screen.findByRole("dialog", { name: "Unlock Work archive" });
    emitAccess({
      databaseId: "other-id",
      status: "suspended",
      reason: "locked",
    });
    await waitFor(() => expect(mocks.discover).toHaveBeenCalledTimes(2));
    await ready();
    expect(
      screen.getByRole("dialog", { name: "Unlock Work archive" }),
    ).toBeInTheDocument();
    expect(mocks.protection).toHaveBeenCalledOnce();
    expect(mocks.unlock).not.toHaveBeenCalled();
    expectNoSyncOrSelectionChange();
  });

  it.each([undefined, false])(
    "defaults automatic OS-vault unlock to unchecked for stored value %s",
    async (value) => {
      render(<Harness initial={{ autoUnlockOsVaultDatabases: value }} />);
      await ready();
      expect(autoUnlockToggle()).not.toBeChecked();
      expect(mocks.protection).not.toHaveBeenCalled();
      expect(mocks.unlock).not.toHaveBeenCalled();
      expectNoSyncOrSelectionChange();
    },
  );

  it("persists only the automatic-unlock boolean and explains its limitations", async () => {
    render(<Harness />);
    await ready();
    const toggle = autoUnlockToggle();
    expect(defaultCloudSyncConfig.autoUnlockOsVaultDatabases).toBe(false);
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(mocks.update.mock.calls).toEqual([
      [{ autoUnlockOsVaultDatabases: true }],
      [{ autoUnlockOsVaultDatabases: false }],
    ]);
    const setting = toggle.closest(
      '[data-setting-key="cloudSync.autoUnlockOsVaultDatabases"]',
    );
    expect(setting).toHaveTextContent(/OS.vault/i);
    expect(setting).toHaveTextContent(/password/i);
    expect(setting).toHaveTextContent(/selected/i);
    expect(
      screen.getByRole("checkbox", { name: /Other archive/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Work archive/ }),
    ).not.toBeChecked();
    expect(mocks.selectDatabase).not.toHaveBeenCalled();
    expect(mocks.protection).not.toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(mocks.syncNow).not.toHaveBeenCalled();
    expect(mocks.syncTarget).not.toHaveBeenCalled();
  });
});
