import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Modal } from "../../src/components/ui/overlays/Modal";

describe("Modal", () => {
  it("focuses a requested action without refocusing on ordinary rerenders", async () => {
    const initialFocusRef = createRef<HTMLButtonElement>();
    const content = (label: string) => (
      <Modal isOpen initialFocusRef={initialFocusRef}>
        <button>Cancel</button>
        <button ref={initialFocusRef}>{label}</button>
      </Modal>
    );
    const { rerender } = render(content("OK"));
    await waitFor(() => expect(screen.getByText("OK")).toHaveFocus());
    const cancel = screen.getByText("Cancel");
    cancel.focus();
    rerender(content("Confirm"));
    expect(cancel).toHaveFocus();
  });

  it("does not move initial focus outside its panel", async () => {
    const initialFocusRef = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={initialFocusRef}>Outside</button>
        <Modal isOpen initialFocusRef={initialFocusRef}>
          <button>Inside</button>
        </Modal>
      </>,
    );
    await waitFor(() => expect(screen.getByText("Inside")).toHaveFocus());
  });

  it("supports an optional accessible name without changing dialog behavior", () => {
    render(
      <Modal isOpen ariaLabel="Review trust identity import">
        <button>Cancel</button>
      </Modal>,
    );
    expect(
      screen.getByRole("dialog", { name: "Review trust identity import" }),
    ).toHaveAttribute("aria-modal", "true");
  });
  it("renders dialog semantics and traps focus within the panel", async () => {
    render(
      <div>
        <button>Before</button>
        <Modal isOpen onClose={() => {}}>
          <div>
            <button>First action</button>
            <button>Last action</button>
          </div>
        </Modal>
        <button>After</button>
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    const first = screen.getByText("First action");
    const last = screen.getByText("Last action");

    expect(dialog).toHaveAttribute("aria-modal", "true");

    await waitFor(() => {
      expect(first).toHaveFocus();
    });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("closes on escape when enabled", () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose}>
        <button>Dismiss</button>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
