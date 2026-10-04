import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { ManagedDatabaseUnlockDialog } from "../../src/components/encryption/DatabaseUnlockDialog";
import { ManagedDatabaseUnlockForm } from "../../src/components/encryption/ManagedDatabaseUnlockForm";
import type { DatabaseProtectionStatus } from "../../src/types/encryption/databaseProtection";

const fixture = vi.hoisted(() => ({ unlock: vi.fn() }));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({ unlockManagedDatabase: fixture.unlock }),
  },
}));
const status: DatabaseProtectionStatus = {
  kind: "managed",
  securityRevision: "r1",
  dataCipher: "aes-256-gcm",
  unlocked: false,
  slots: [
    {
      id: "password",
      type: "password",
      label: "Recovery password",
      deviceBound: false,
    },
  ],
};
const vaultSlot = {
  id: "vault",
  type: "os-vault" as const,
  label: "This device",
  deviceBound: true,
};
const withVault = { ...status, slots: [...status.slots, vaultSlot] };
beforeEach(() => {
  fixture.unlock.mockReset().mockResolvedValue(undefined);
});
describe("database authentication popup", () => {
  it("uses an explicitly named, bounded dialog and cancellation before auth never reads the vault", () => {
    const close = vi.fn();
    const { unmount } = render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work database"
        status={status}
        onClose={close}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Unlock Work database" });
    expect(dialog.querySelector(".sor-modal-body")?.className).toContain(
      "overflow-y-auto",
    );
    expect(dialog.querySelector(".sor-modal-footer")?.className).toContain(
      "shrink-0",
    );
    expect(dialog.className).toContain("max-h-");
    expect(fixture.unlock).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Database password"), {
      target: { value: "cancelled-secret" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel database unlock" }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(fixture.unlock).not.toHaveBeenCalled();
    unmount();
    render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work database"
        status={status}
        onClose={close}
      />,
    );
    expect(screen.getByLabelText("Database password")).toHaveValue("");
  });
  it("blocks cancel, Escape and backdrop while authenticating, then completes exactly once", async () => {
    let resolve!: () => void;
    fixture.unlock.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const close = vi.fn();
    const completed = vi.fn();
    render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work database"
        status={status}
        onClose={close}
        onUnlockComplete={completed}
      />,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(screen.getByLabelText("Database password"), {
      target: { value: "fixture-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    expect(screen.getByLabelText("Database password")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Authenticating database…" }),
    ).toBeDisabled();
    // A second submit must remain harmless even if it bypasses the disabled button.
    fireEvent.submit(
      screen.getByLabelText("Database password").closest("form")!,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel database unlock" }),
    );
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(fixture.unlock).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Database password")).toHaveValue("");
    await act(async () => resolve());
    expect(completed).toHaveBeenCalledOnce();
  });
  it("tries the vault first and falls back to the password form without retrying automatically", async () => {
    const progress = vi.fn();
    fixture.unlock.mockRejectedValueOnce(new Error("Vault access unavailable"));
    render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work database"
        status={withVault}
        onClose={vi.fn()}
        onUnlockProgress={progress}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByText("Vault access unavailable");
    expect(fixture.unlock).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Database password")).toBeInTheDocument();
    const method = screen.getByRole("combobox", {
      name: "Database unlock method",
    });
    expect(method).toHaveClass("sor-form-select", "sor-select-trigger");
    expect(screen.getByRole("dialog").querySelector("select")).toBeNull();
    fireEvent.click(method);
    expect(screen.getByRole("dialog")).toContainElement(
      screen.getByRole("listbox"),
    );
    expect(
      screen.getByRole("listbox").closest(".sor-select-dropdown"),
    ).toHaveClass("sor-popover-panel");
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "This device (OS vault · this device)",
      }),
    );
    expect(fixture.unlock).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Database password")).toBeNull();
    fixture.unlock.mockRejectedValueOnce(new Error("Vault still unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    await screen.findByText("Vault still unavailable");
    expect(fixture.unlock).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls).toEqual([
      ["unlocking"],
      ["waiting-unlock"],
      ["unlocking"],
      ["failed"],
    ]);
    expect(fixture.unlock).toHaveBeenCalledWith("work", "vault", undefined, {
      isCurrent: expect.any(Function),
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Cancel database unlock" }),
      ).not.toBeDisabled(),
    );
  });

  it("keeps unsupported unlock methods disabled in the themed menu", () => {
    render(
      <ManagedDatabaseUnlockForm
        databaseId="work"
        preferPassword
        status={{
          ...withVault,
          slots: [
            ...withVault.slots,
            {
              id: "biometric",
              type: "biometric",
              label: "Fingerprint",
              deviceBound: true,
            },
          ],
        }}
      />,
    );
    const method = screen.getByRole("combobox", {
      name: "Database unlock method",
    });
    fireEvent.click(method);
    const unsupported = screen.getByRole("option", {
      name: "Fingerprint (biometric)",
    });
    expect(unsupported).toHaveAttribute("aria-disabled", "true");
    fireEvent.mouseDown(unsupported);
    expect(method).toHaveTextContent("Recovery password (password)");
    expect(screen.getByLabelText("Database password")).toBeInTheDocument();
    expect(fixture.unlock).not.toHaveBeenCalled();
    fireEvent.keyDown(method, { key: "ArrowDown" });
    fireEvent.keyDown(method, { key: "Enter" });
    expect(method).toHaveTextContent("This device (OS vault · this device)");
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "uses only progress callbacks during OS vault unlock, without inline UI (with recovery password: %s)",
    async (recovery) => {
      let resolve!: () => void;
      fixture.unlock.mockImplementation(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      );
      const completed = vi.fn();
      const progress = vi.fn();
      const close = vi.fn();
      const content = () => (
        <StrictMode>
          <ManagedDatabaseUnlockDialog
            databaseId="work"
            databaseName="Work"
            status={recovery ? withVault : { ...status, slots: [vaultSlot] }}
            onClose={close}
            onUnlockComplete={completed}
            onUnlockProgress={progress}
          />
        </StrictMode>
      );
      const view = render(content());
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(view.container).toBeEmptyDOMElement();
      await waitFor(() => expect(fixture.unlock).toHaveBeenCalledOnce());
      // Keep the native operation pending across a parent rerender. StrictMode
      // and rerenders must not start a duplicate unlock.
      view.rerender(content());
      expect(view.container).toBeEmptyDOMElement();
      expect(completed).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(fixture.unlock).toHaveBeenCalledExactlyOnceWith(
        "work",
        "vault",
        undefined,
        { isCurrent: expect.any(Function) },
      );
      expect(progress).toHaveBeenCalledExactlyOnceWith("unlocking");
      await act(async () => resolve());
      expect(completed).toHaveBeenCalledOnce();
      expect(fixture.unlock).toHaveBeenCalledOnce();
      expect(view.container).toBeEmptyDOMElement();
      expect(screen.queryByRole("combobox")).toBeNull();
    },
  );

  it("ignores a vault completion after the explicit unlock UI is unmounted", async () => {
    let resolve!: () => void;
    fixture.unlock.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const completed = vi.fn();
    const view = render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work"
        status={withVault}
        onClose={vi.fn()}
        onUnlockComplete={completed}
      />,
    );
    await waitFor(() => expect(fixture.unlock).toHaveBeenCalledOnce());
    const isCurrent = fixture.unlock.mock.calls[0][3].isCurrent;
    expect(isCurrent()).toBe(true);
    view.unmount();
    expect(isCurrent()).toBe(false);
    await act(async () => resolve());
    expect(completed).not.toHaveBeenCalled();
  });

  it("does not unlock from the lock/expiry form until the user presses Unlock", async () => {
    render(<ManagedDatabaseUnlockForm databaseId="work" status={withVault} />);
    expect(fixture.unlock).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toHaveTextContent("OS vault");
    expect(screen.queryByLabelText("Database password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    await waitFor(() => expect(fixture.unlock).toHaveBeenCalledOnce());
    expect(fixture.unlock).toHaveBeenCalledWith("work", "vault", undefined, {
      isCurrent: expect.any(Function),
    });
  });

  it("invalidates an old vault request when the database or protection revision changes", async () => {
    let resolveOld!: () => void;
    fixture.unlock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const oldCompleted = vi.fn();
    const newCompleted = vi.fn();
    const { rerender } = render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work"
        status={withVault}
        onClose={vi.fn()}
        onUnlockComplete={oldCompleted}
      />,
    );
    await waitFor(() => expect(fixture.unlock).toHaveBeenCalledOnce());
    const isOldCurrent = fixture.unlock.mock.calls[0][3].isCurrent;
    rerender(
      <ManagedDatabaseUnlockDialog
        databaseId="other"
        databaseName="Other"
        status={{ ...withVault, securityRevision: "r2" }}
        onClose={vi.fn()}
        onUnlockComplete={newCompleted}
      />,
    );
    expect(isOldCurrent()).toBe(false);
    await waitFor(() => expect(newCompleted).toHaveBeenCalledOnce());
    await act(async () => resolveOld());
    expect(oldCompleted).not.toHaveBeenCalled();
    expect(newCompleted).toHaveBeenCalledOnce();
    expect(fixture.unlock).toHaveBeenCalledTimes(2);
    expect(fixture.unlock).toHaveBeenLastCalledWith(
      "other",
      "vault",
      undefined,
      {
        isCurrent: expect.any(Function),
      },
    );
  });

  it("allows recovery password authentication after a vault failure", async () => {
    fixture.unlock.mockRejectedValueOnce(new Error("No key on this device"));
    const completed = vi.fn();
    render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work"
        status={withVault}
        onClose={vi.fn()}
        onUnlockComplete={completed}
      />,
    );
    const password = await screen.findByLabelText("Database password");
    fireEvent.change(password, {
      target: { value: "fixture-recovery-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    await waitFor(() => expect(completed).toHaveBeenCalledOnce());
    expect(fixture.unlock).toHaveBeenCalledTimes(2);
    expect(fixture.unlock).toHaveBeenLastCalledWith(
      "work",
      "password",
      "fixture-recovery-password",
      { isCurrent: expect.any(Function) },
    );
    expect(password).toHaveValue("");
  });

  it("hides the selector for a vault-only form and permits an explicit retry after failure", async () => {
    fixture.unlock.mockRejectedValueOnce(new Error("Vault unavailable"));
    const close = vi.fn();
    render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work"
        status={{ ...status, slots: [vaultSlot] }}
        onClose={close}
      />,
    );
    await screen.findByText("Vault unavailable");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText("Database password")).toBeNull();
    expect(fixture.unlock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    await waitFor(() => expect(fixture.unlock).toHaveBeenCalledTimes(2));
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not guess between multiple enrolled OS vault slots", () => {
    render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work"
        status={{
          ...withVault,
          slots: [
            ...withVault.slots,
            { ...vaultSlot, id: "other-vault", label: "Other device" },
          ],
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it("closes an abandoned vault request without reopening a password prompt", async () => {
    fixture.unlock.mockRejectedValueOnce(
      new DOMException("Cancelled", "AbortError"),
    );
    const close = vi.fn();
    const progress = vi.fn();
    render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work"
        status={withVault}
        onClose={close}
        onUnlockProgress={progress}
      />,
    );
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(progress).toHaveBeenLastCalledWith("cancelled");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.unlock).toHaveBeenCalledOnce();
  });
});
