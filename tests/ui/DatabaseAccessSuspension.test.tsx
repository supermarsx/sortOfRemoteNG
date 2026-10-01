import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseAccessNotice } from "../../src/components/encryption/DatabaseAccessNotice";
import { ManagedDatabaseUnlockForm } from "../../src/components/encryption/ManagedDatabaseUnlockForm";
import { useDatabaseAccessSuspension } from "../../src/hooks/settings/useDatabaseAccessSuspension";
import { ConfirmDialog } from "../../src/components/ui/dialogs/ConfirmDialog";
import { UnlockScreen } from "../../src/components/encryption/UnlockScreen";
import type {
  DatabaseAccessState,
  DatabaseProtectionStatus,
} from "../../src/types/encryption/databaseProtection";

const mocks = vi.hoisted(() => ({
  current: { id: "work", name: "Work database" } as {
    id: string;
    name: string;
  } | null,
  access: new Map<string, DatabaseAccessState>(),
  accessListeners: new Set<() => void>(),
  currentListeners: new Set<() => void>(),
  inspect: vi.fn(),
  unlock: vi.fn(),
  close: vi.fn(),
  load: vi.fn(),
  globalUnlock: vi.fn(),
  globalLocked: false,
  openSettings: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => {
  const manager = {
    getCurrentDatabase: () => mocks.current,
    getDatabaseAccessState: (id: string) => mocks.access.get(id) ?? null,
    getDatabaseProtectionStatus: (...args: unknown[]) => mocks.inspect(...args),
    unlockManagedDatabase: (...args: unknown[]) => mocks.unlock(...args),
    closeCurrentDatabase: mocks.close,
    loadDatabaseData: mocks.load,
    onCurrentDatabaseChange: (listener: () => void) => {
      mocks.currentListeners.add(listener);
      return () => mocks.currentListeners.delete(listener);
    },
  };
  return {
    DatabaseManager: { getInstance: () => manager },
    onDatabaseAccessChange: (listener: () => void) => {
      mocks.accessListeners.add(listener);
      return () => mocks.accessListeners.delete(listener);
    },
  };
});
vi.mock("../../src/hooks/settings/useEncryption", () => ({
  useEncryption: () => ({
    status: {
      unlocked: !mocks.globalLocked,
      passwordWrapPresent: true,
      settingsEncryptedOnDisk: true,
      vaultAvailable: false,
    },
    loading: false,
    lockout: { remainingCooldownMs: 0 },
    unlock: mocks.globalUnlock,
  }),
}));

const protection: DatabaseProtectionStatus = {
  kind: "managed",
  version: 1,
  securityRevision: "r1",
  dataCipher: "aes-256-gcm",
  unlocked: false,
  slots: [
    {
      id: "portable",
      type: "password",
      label: "Portable password",
      deviceBound: false,
    },
    {
      id: "device",
      type: "os-vault",
      label: "This computer",
      deviceBound: true,
    },
  ],
};
function access(
  status: "ready" | "suspended",
  reason: DatabaseAccessState["reason"] = "expired",
  id = "work",
  epoch = "e1",
): DatabaseAccessState {
  return {
    databaseId: id,
    securityRevision: "r1",
    accessEpoch: epoch,
    status,
    reason,
  };
}
function emit(next: DatabaseAccessState) {
  act(() => {
    mocks.access.set(next.databaseId, next);
    mocks.accessListeners.forEach((listener) => listener());
  });
}
async function choosePassword() {
  fireEvent.click(
    await screen.findByRole("combobox", { name: "Database unlock method" }),
  );
  fireEvent.mouseDown(
    screen.getByRole("option", { name: "Portable password (password)" }),
  );
  return screen.getByLabelText("Database password");
}
function Harness({ portal = false }: { portal?: boolean }) {
  const guard = useDatabaseAccessSuspension();
  const [draft, setDraft] = useState("saved value");
  return (
    <>
      <div
        data-testid="app-shell"
        hidden={mocks.globalLocked}
        inert={mocks.globalLocked}
      >
        <button onClick={mocks.openSettings}>Settings</button>
        <div
          data-testid="editors"
          hidden={guard.blocked}
          inert={guard.blocked}
          aria-hidden={guard.blocked || undefined}
        >
          <label>
            Unsaved editor
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
        </div>
        {portal && (
          <ConfirmDialog
            isOpen
            message="Discard dirty work?"
            onConfirm={mocks.close}
          />
        )}
        <DatabaseAccessNotice
          access={guard}
          globallyLocked={mocks.globalLocked}
        />
      </div>
      <UnlockScreen />
    </>
  );
}

describe("managed database access suspension boundary", () => {
  beforeEach(() => {
    mocks.current = { id: "work", name: "Work database" };
    mocks.access.clear();
    mocks.access.set("work", access("ready", "unlocked"));
    mocks.accessListeners.clear();
    mocks.currentListeners.clear();
    mocks.inspect.mockReset().mockResolvedValue(protection);
    mocks.unlock
      .mockReset()
      .mockImplementation(async () =>
        emit(access("ready", "unlocked", "work", "e2")),
      );
    mocks.close.mockReset();
    mocks.load.mockReset();
    mocks.globalLocked = false;
    mocks.openSettings.mockReset();
    mocks.globalUnlock.mockReset().mockResolvedValue("wrong-password");
  });
  afterEach(cleanup);

  it("keeps the shell usable while masking locked database views until explicit reauthentication", async () => {
    render(<Harness />);
    const editor = screen.getByLabelText("Unsaved editor");
    fireEvent.change(editor, { target: { value: "unsaved local edits" } });
    emit(access("suspended"));
    expect(screen.getByTestId("editors")).toHaveAttribute("hidden");
    expect(screen.getByTestId("editors")).toHaveAttribute("inert");
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(screen.getByTestId("app-shell")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("app-shell")).not.toHaveAttribute("inert");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Work database — Database locked.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(mocks.openSettings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Unlock…" }));
    const password = await choosePassword();
    fireEvent.change(password, { target: { value: "database-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    await waitFor(() =>
      expect(screen.queryByTestId("database-access-notice")).toBeNull(),
    );
    expect(mocks.unlock).toHaveBeenCalledWith(
      "work",
      "portable",
      "database-secret",
      { isCurrent: expect.any(Function) },
    );
    expect(editor).toHaveValue("unsaved local edits");
    expect(screen.getByTestId("editors")).not.toHaveAttribute("hidden");
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("keeps views inaccessible after native refusal and ignores an unvalidated ready notification", async () => {
    render(<Harness />);
    emit(access("suspended", "locked"));
    fireEvent.click(screen.getByRole("button", { name: "Unlock…" }));
    mocks.unlock.mockRejectedValue(
      new Error("Native unlock rejected this credential"),
    );
    fireEvent.change(await choosePassword(), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Native unlock rejected",
    );
    expect(screen.getByLabelText("Database password")).toHaveValue("");
    act(() => mocks.accessListeners.forEach((listener) => listener()));
    expect(screen.getByTestId("database-access-notice")).toBeInTheDocument();
    expect(screen.getByTestId("editors")).toHaveAttribute("hidden");
  });

  it("defaults to OS vault but requires explicit unlock and never treats it as a master unlock", async () => {
    render(<Harness />);
    emit(access("suspended"));
    fireEvent.click(screen.getByRole("button", { name: "Unlock…" }));
    expect(
      await screen.findByRole("combobox", { name: "Database unlock method" }),
    ).toHaveTextContent("This computer (OS vault · this device)");
    fireEvent.click(
      await screen.findByRole("combobox", { name: "Database unlock method" }),
    );
    expect(screen.getByTestId("database-access-notice")).toContainElement(
      screen.getByRole("listbox"),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "This computer (OS vault · this device)",
      }),
    );
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Database password")).toBeNull();
    expect(screen.getByText(/not a master-key unlock/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    await waitFor(() =>
      expect(mocks.unlock).toHaveBeenCalledWith("work", "device", undefined, {
        isCurrent: expect.any(Function),
      }),
    );
    expect(mocks.globalUnlock).not.toHaveBeenCalled();
  });

  it("does not intercept app actions, while the global master lock still takes precedence", async () => {
    const rendered = render(<Harness portal />);
    emit(access("suspended"));
    fireEvent.click(screen.getByRole("button", { name: "Unlock…" }));
    const password = await choosePassword();
    fireEvent.click(screen.getByTestId("confirm-yes"));
    expect(mocks.close).toHaveBeenCalledOnce();
    fireEvent.change(password, { target: { value: "not-submitted" } });
    mocks.globalLocked = true;
    rendered.rerender(<Harness portal />);
    expect(screen.queryByTestId("database-access-notice")).toBeNull();
    const global = screen.getByTestId("encryption-unlock-screen");
    expect(global).not.toHaveAttribute("inert");
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "master-only" },
    });
    fireEvent.keyDown(screen.getByLabelText("Master password"), {
      key: "Enter",
    });
    await waitFor(() =>
      expect(mocks.globalUnlock).toHaveBeenCalledWith("master-only"),
    );
    expect(mocks.unlock).not.toHaveBeenCalled();
  });

  it("discards late unlock-method responses after active database changes", async () => {
    let resolveOld: (value: DatabaseProtectionStatus) => void = () => undefined;
    mocks.inspect.mockImplementation((id: string) =>
      id === "work"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({
            ...protection,
            slots: [
              {
                id: "new-slot",
                type: "password",
                label: "New database method",
                deviceBound: false,
              },
            ],
          }),
    );
    render(<Harness />);
    emit(access("suspended"));
    fireEvent.click(screen.getByRole("button", { name: "Unlock…" }));
    act(() => {
      mocks.current = { id: "other", name: "Other database" };
      mocks.access.set("other", access("suspended", "locked", "other"));
      mocks.currentListeners.forEach((listener) => listener());
    });
    expect(screen.queryByText("New database method (password)")).toBeNull();
    expect(screen.getByRole("button", { name: "Unlock…" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlock…" }));
    await screen.findByText("New database method (password)");
    await act(async () => resolveOld(protection));
    expect(screen.queryByText("Portable password (password)")).toBeNull();
    expect(
      screen.getByText("New database method (password)"),
    ).toBeInTheDocument();
  });

  it("keeps the shell usable on status-read failure and offers an explicit retry", async () => {
    mocks.inspect.mockRejectedValueOnce(
      new Error("Could not inspect native database"),
    );
    render(<Harness />);
    emit(access("suspended"));
    fireEvent.click(screen.getByRole("button", { name: "Unlock…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not inspect native database",
    );
    expect(screen.getByTestId("editors")).toHaveAttribute("hidden");
    expect(screen.getByTestId("app-shell")).not.toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(mocks.openSettings).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh unlock methods" }),
    );
    expect(
      await screen.findByRole("combobox", { name: "Database unlock method" }),
    ).toHaveTextContent("OS vault");
    expect(mocks.unlock).not.toHaveBeenCalled();
  });

  it("never steals focus on lock and clears entered passwords when unlock options are hidden", async () => {
    render(<Harness />);
    const settings = screen.getByRole("button", { name: "Settings" });
    settings.focus();
    emit(access("suspended"));
    expect(settings).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Unlock…" }));
    fireEvent.change(await choosePassword(), {
      target: { value: "unsent-secret" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Hide unlock options" }),
    );
    expect(screen.queryByLabelText("Database password")).toBeNull();
    expect(screen.getByTestId("database-access-notice")).toBeInTheDocument();
    expect(mocks.unlock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unlock…" }));
    expect(await choosePassword()).toHaveValue("");
  });

  it("ignores a completed authentication after its selection form unmounts", async () => {
    let resolve: () => void = () => undefined;
    mocks.unlock.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const completed = vi.fn();
    const rendered = render(
      <ManagedDatabaseUnlockForm
        databaseId="work"
        status={protection}
        onUnlockComplete={completed}
      />,
    );
    fireEvent.change(await choosePassword(), {
      target: { value: "fixture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    const validity = mocks.unlock.mock.calls[0][3].isCurrent as () => boolean;
    expect(validity()).toBe(true);
    rendered.unmount();
    expect(validity()).toBe(false);
    await act(async () => resolve());
    expect(completed).not.toHaveBeenCalled();
  });
  it("invalidates the old authentication on scope change and clears the displayed password", async () => {
    let resolve!: () => void;
    mocks.unlock.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const completed = vi.fn();
    const { rerender } = render(
      <ManagedDatabaseUnlockForm
        databaseId="work"
        status={protection}
        onUnlockComplete={completed}
      />,
    );
    fireEvent.change(await choosePassword(), {
      target: { value: "old-scope-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    const validity = mocks.unlock.mock.calls[0][3].isCurrent as () => boolean;
    rerender(
      <ManagedDatabaseUnlockForm
        databaseId="other"
        status={{ ...protection, securityRevision: "r2" }}
        onUnlockComplete={completed}
      />,
    );
    expect(validity()).toBe(false);
    expect(screen.queryByLabelText("Database password")).toBeNull();
    await act(async () => resolve());
    expect(completed).not.toHaveBeenCalled();
    expect(await choosePassword()).toHaveValue("");
  });
});
