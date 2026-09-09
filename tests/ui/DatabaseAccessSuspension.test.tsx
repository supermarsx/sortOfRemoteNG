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
import { DatabaseAccessSuspensionScreen } from "../../src/components/encryption/DatabaseAccessSuspensionScreen";
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
function Harness({ portal = false }: { portal?: boolean }) {
  const guard = useDatabaseAccessSuspension();
  const [draft, setDraft] = useState("saved value");
  return (
    <>
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
      <DatabaseAccessSuspensionScreen
        access={guard}
        globallyLocked={mocks.globalLocked}
      />
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
    mocks.globalUnlock.mockReset().mockResolvedValue("wrong-password");
  });
  afterEach(cleanup);

  it("hides expired views and preserves their exact dirty state through explicit reauthentication", async () => {
    render(<Harness />);
    const editor = screen.getByLabelText("Unsaved editor");
    fireEvent.change(editor, { target: { value: "unsaved local edits" } });
    emit(access("suspended"));
    expect(screen.getByTestId("editors")).toHaveAttribute("hidden");
    expect(screen.getByTestId("editors")).toHaveAttribute("inert");
    expect(mocks.unlock).not.toHaveBeenCalled();
    const password = await screen.findByLabelText("Database password");
    fireEvent.change(password, { target: { value: "database-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    await waitFor(() =>
      expect(screen.queryByTestId("database-access-suspended")).toBeNull(),
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
    mocks.unlock.mockRejectedValue(
      new Error("Native unlock rejected this credential"),
    );
    fireEvent.change(await screen.findByLabelText("Database password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Native unlock rejected",
    );
    expect(screen.getByLabelText("Database password")).toHaveValue("");
    act(() => mocks.accessListeners.forEach((listener) => listener()));
    expect(screen.getByTestId("database-access-suspended")).toBeInTheDocument();
    expect(screen.getByTestId("editors")).toHaveAttribute("hidden");
  });

  it("requires explicit OS-vault selection and never treats it as a master unlock", async () => {
    render(<Harness />);
    emit(access("suspended"));
    fireEvent.change(await screen.findByLabelText("Database unlock method"), {
      target: { value: "device" },
    });
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

  it("blocks background portal commands and gives the global master gate precedence", async () => {
    const rendered = render(<Harness portal />);
    emit(access("suspended"));
    const password = await screen.findByLabelText("Database password");
    fireEvent.keyDown(password, { key: "Escape" });
    fireEvent.click(screen.getByTestId("confirm-yes"));
    expect(mocks.close).not.toHaveBeenCalled();
    mocks.globalLocked = true;
    rendered.rerender(<Harness portal />);
    expect(screen.queryByTestId("database-access-suspended")).toBeNull();
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
    act(() => {
      mocks.current = { id: "other", name: "Other database" };
      mocks.access.set("other", access("suspended", "locked", "other"));
      mocks.currentListeners.forEach((listener) => listener());
    });
    await screen.findByText("New database method (password)");
    await act(async () => resolveOld(protection));
    expect(screen.queryByText("Portable password (password)")).toBeNull();
    expect(
      screen.getByText("New database method (password)"),
    ).toBeInTheDocument();
  });

  it("retains the blocking overlay on status-read failure with an explicit retry", async () => {
    mocks.inspect.mockRejectedValueOnce(
      new Error("Could not inspect native database"),
    );
    render(<Harness />);
    emit(access("suspended"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not inspect native database",
    );
    expect(screen.getByTestId("editors")).toHaveAttribute("hidden");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh unlock methods" }),
    );
    expect(
      await screen.findByLabelText("Database password"),
    ).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Database password"), {
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
    fireEvent.change(screen.getByLabelText("Database password"), {
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
    expect(screen.getByLabelText("Database password")).toHaveValue("");
    await act(async () => resolve());
    expect(completed).not.toHaveBeenCalled();
  });
});
