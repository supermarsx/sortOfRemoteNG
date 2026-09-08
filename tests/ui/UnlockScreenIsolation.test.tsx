import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnlockScreen } from "../../src/components/encryption/UnlockScreen";
import { ConfirmDialog } from "../../src/components/ui/dialogs/ConfirmDialog";

const state = vi.hoisted(() => ({ unlocked: false, unlock: vi.fn() }));
vi.mock("../../src/hooks/settings/useEncryption", () => ({
  useEncryption: () => ({
    status: {
      unlocked: state.unlocked,
      passwordWrapPresent: true,
      settingsEncryptedOnDisk: true,
      vaultAvailable: false,
    },
    loading: false,
    lockout: { remainingCooldownMs: 0 },
    unlock: state.unlock,
  }),
}));
beforeEach(() => {
  state.unlocked = false;
  state.unlock.mockReset().mockResolvedValue("wrong-password");
});
describe("Unlock screen portal isolation", () => {
  it("password Enter unlocks without confirming or cancelling a real background portal", async () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(
      <>
        <ConfirmDialog
          isOpen
          message="Delete data?"
          onConfirm={confirm}
          onCancel={cancel}
        />
        <UnlockScreen />
      </>,
    );
    const password = screen.getByLabelText("Master password");
    fireEvent.change(password, { target: { value: "fixture-password" } });
    fireEvent.keyDown(password, { key: "Enter" });
    await waitFor(() =>
      expect(state.unlock).toHaveBeenCalledWith("fixture-password"),
    );
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.keyDown(password, { key: "Escape" });
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-yes"));
    expect(confirm).not.toHaveBeenCalled();
  });
  it("isolates newly mounted portals and prevents delayed background autofocus", async () => {
    const View = ({ portal }: { portal: boolean }) => (
      <>
        {portal && (
          <ConfirmDialog isOpen message="Later dialog" onConfirm={vi.fn()} />
        )}
        <UnlockScreen />
      </>
    );
    const { rerender } = render(<View portal={false} />);
    rerender(<View portal />);
    const backdrop = screen.getByTestId("confirm-dialog");
    await waitFor(() => expect(backdrop).toHaveAttribute("inert"));
    act(() => screen.getByTestId("confirm-yes").focus());
    expect(screen.getByTestId("encryption-unlock-screen")).toContainElement(
      document.activeElement as HTMLElement,
    );
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(screen.getByTestId("encryption-unlock-screen")).toContainElement(
      document.activeElement as HTMLElement,
    );
  });
  it("cycles Tab within unlock and restores previous background attributes on unlock", async () => {
    const { rerender } = render(
      <>
        <div data-testid="background" aria-hidden="false">
          <button>Background</button>
        </div>
        <UnlockScreen />
      </>,
    );
    const background = screen.getByTestId("background");
    expect(background).toHaveAttribute("inert");
    const password = screen.getByLabelText("Master password");
    const toggle = screen.getByTestId("unlock-import-toggle");
    act(() => password.focus());
    fireEvent.keyDown(password, { key: "Tab", shiftKey: true });
    expect(toggle).toHaveFocus();
    fireEvent.keyDown(toggle, { key: "Tab" });
    expect(password).toHaveFocus();
    state.unlocked = true;
    rerender(
      <>
        <div data-testid="background" aria-hidden="false">
          <button>Background</button>
        </div>
        <UnlockScreen />
      </>,
    );
    expect(background).not.toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "false");
    const button = screen.getByRole("button", { name: "Background" });
    act(() => button.focus());
    expect(button).toHaveFocus();
  });
  it("releases listeners on unmount without removing pre-existing isolation", () => {
    const confirm = vi.fn();
    const View = ({ locked }: { locked: boolean }) => (
      <>
        <div data-testid="already-inert" inert aria-hidden="true" />
        <ConfirmDialog
          isOpen
          message="Confirm after unlock"
          onConfirm={confirm}
        />
        {locked && <UnlockScreen />}
      </>
    );
    const { rerender } = render(<View locked />);
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(confirm).not.toHaveBeenCalled();
    rerender(<View locked={false} />);
    expect(screen.getByTestId("already-inert")).toHaveAttribute("inert");
    expect(screen.getByTestId("already-inert")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("confirm-dialog")).not.toHaveAttribute("inert");
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(confirm).toHaveBeenCalledOnce();
  });
});
