import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedDatabaseUnlockDialog } from "../../src/components/encryption/DatabaseUnlockDialog";
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
    { id: "vault", type: "os-vault", label: "This device", deviceBound: true },
  ],
};
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
  it("offers vault use only after explicit selection and keeps an auth failure in the popup", async () => {
    const progress = vi.fn();
    fixture.unlock.mockRejectedValueOnce(new Error("Vault access unavailable"));
    render(
      <ManagedDatabaseUnlockDialog
        databaseId="work"
        databaseName="Work database"
        status={status}
        onClose={vi.fn()}
        onUnlockProgress={progress}
      />,
    );
    fireEvent.change(screen.getByLabelText("Database unlock method"), {
      target: { value: "vault" },
    });
    expect(fixture.unlock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Database password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unlock database" }));
    await screen.findByText("Vault access unavailable");
    expect(progress.mock.calls).toEqual([["unlocking"], ["failed"]]);
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
});
