import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../src/components/ui/dialogs/ConfirmDialog";
import styles from "../../src/components/ui/dialogs/ConfirmDialog.module.css";

describe("session confirmation toast motion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    "confirm-yes",
    "confirm-no",
    "modal-close",
    "confirm-secondary",
    "Escape",
    "Enter",
  ])(
    "animates %s before parent unmount and settles only the first action",
    (action) => {
      const settled = vi.fn();
      function Host() {
        const [open, setOpen] = useState(true);
        const settle = (choice: string) => {
          settled(choice);
          setOpen(false);
        };
        return open ? (
          <ConfirmDialog
            isOpen
            presentation="toast"
            title="Close tab?"
            message="Disconnect the session?"
            onConfirm={() => settle("confirm")}
            onCancel={() => settle("cancel")}
            secondaryAction={{
              label: "Keep",
              onClick: () => settle("secondary"),
            }}
          />
        ) : null;
      }
      render(<Host />);
      const panel = screen.getByRole("dialog", { name: "Close tab?" });
      expect(panel).toHaveClass(styles.toast);
      expect(panel).not.toHaveAttribute("aria-modal");
      if (action === "Escape" || action === "Enter") {
        fireEvent.keyDown(document, { key: action });
      } else {
        fireEvent.click(screen.getByTestId(action));
      }
      expect(panel).toHaveClass(styles.exiting);
      expect(settled).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("confirm-yes"));
      fireEvent.keyDown(document, { key: "Escape" });
      act(() => vi.advanceTimersByTime(159));
      expect(settled).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(settled).toHaveBeenCalledExactlyOnceWith(
        action === "confirm-yes" || action === "Enter"
          ? "confirm"
          : action === "confirm-secondary"
            ? "secondary"
            : "cancel",
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("preserves focused Cancel semantics and restores focus after exiting", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = render(
      <ConfirmDialog
        isOpen
        presentation="toast"
        message="Close?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    act(() => vi.advanceTimersByTime(20));
    const cancel = screen.getByTestId("confirm-no");
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Enter" });
    expect(screen.getByRole("dialog")).not.toHaveClass(styles.exiting);
    fireEvent.click(cancel); // Native keyboard activation in the browser.
    expect(cancel).toHaveFocus();
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    act(() => vi.advanceTimersByTime(160));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("settles immediately when reduced motion is requested", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        presentation="toast"
        message="Close?"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    fireEvent.click(screen.getByTestId("confirm-yes"));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).not.toHaveClass(styles.exiting);
  });

  it("cancels a pending action on external close and reopens without exit state", () => {
    const onConfirm = vi.fn();
    const props = {
      message: "Close?",
      onConfirm,
      presentation: "toast" as const,
    };
    const { rerender } = render(<ConfirmDialog {...props} isOpen />);
    fireEvent.click(screen.getByTestId("confirm-yes"));
    rerender(<ConfirmDialog {...props} isOpen={false} />);
    act(() => vi.advanceTimersByTime(200));
    expect(onConfirm).not.toHaveBeenCalled();
    rerender(<ConfirmDialog {...props} isOpen />);
    expect(screen.getByRole("dialog")).not.toHaveClass(styles.exiting);
  });

  it("replaces a pending prompt without settling its stale action", () => {
    const oldAction = vi.fn();
    const newAction = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        isOpen
        presentation="toast"
        message="Close first?"
        onConfirm={oldAction}
      />,
    );
    const firstPanel = screen.getByRole("dialog");
    fireEvent.click(screen.getByTestId("confirm-yes"));
    rerender(
      <ConfirmDialog
        isOpen
        presentation="toast"
        message="Close second?"
        onConfirm={newAction}
      />,
    );
    const nextPanel = screen.getByRole("dialog");
    expect(nextPanel).not.toBe(firstPanel);
    expect(nextPanel).toHaveClass(styles.toast);
    expect(nextPanel).not.toHaveClass(styles.exiting);
    act(() => vi.advanceTimersByTime(200));
    expect(oldAction).not.toHaveBeenCalled();
    expect(newAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-yes"));
    act(() => vi.advanceTimersByTime(160));
    expect(newAction).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "restarts identical keyed queued prompts (reduced motion: %s)",
    (reduced) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: reduced })),
      );
      const settled = vi.fn();
      function Queue() {
        const [request, setRequest] = useState(0);
        return (
          <ConfirmDialog
            key={request}
            isOpen
            presentation="toast"
            message="Close tab?"
            onConfirm={() => {
              settled(request);
              setRequest(request + 1);
            }}
          />
        );
      }
      render(<Queue />);
      const firstPanel = screen.getByRole("dialog");
      fireEvent.click(screen.getByTestId("confirm-yes"));
      if (!reduced) act(() => vi.advanceTimersByTime(160));
      expect(settled).toHaveBeenCalledExactlyOnceWith(0);
      expect(screen.getByRole("dialog")).not.toBe(firstPanel);
      expect(screen.getByRole("dialog")).not.toHaveClass(styles.exiting);
      fireEvent.click(screen.getByTestId("confirm-yes"));
      if (!reduced) act(() => vi.advanceTimersByTime(160));
      expect(settled).toHaveBeenLastCalledWith(1);
      expect(settled).toHaveBeenCalledTimes(2);
    },
  );

  it("does not restart a pending request when callback props rerender", () => {
    const settled = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        isOpen
        presentation="toast"
        message="Close?"
        onConfirm={() => settled("original")}
      />,
    );
    const panel = screen.getByRole("dialog");
    fireEvent.click(screen.getByTestId("confirm-yes"));
    rerender(
      <ConfirmDialog
        isOpen
        presentation="toast"
        message="Close?"
        onConfirm={() => settled("rerender")}
      />,
    );
    expect(screen.getByRole("dialog")).toBe(panel);
    act(() => vi.advanceTimersByTime(160));
    fireEvent.click(screen.getByTestId("confirm-yes"));
    expect(settled).toHaveBeenCalledExactlyOnceWith("original");
  });

  it("cancels an exit's pending action on unmount", () => {
    const onConfirm = vi.fn();
    const { unmount } = render(
      <ConfirmDialog
        isOpen
        presentation="toast"
        message="Close?"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    unmount();
    act(() => vi.advanceTimersByTime(200));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels a stale closure when an identical keyed request replaces an exiting one", () => {
    let activeRequest = 1;
    const settled = vi.fn();
    // Like settleDialog, this callback consults the current queue head.
    const settle = () => settled(activeRequest);
    const { rerender } = render(
      <ConfirmDialog
        key={1}
        isOpen
        presentation="toast"
        message="Close tab?"
        onConfirm={settle}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    activeRequest = 2;
    rerender(
      <ConfirmDialog
        key={2}
        isOpen
        presentation="toast"
        message="Close tab?"
        onConfirm={settle}
      />,
    );
    act(() => vi.advanceTimersByTime(200));
    expect(settled).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).not.toHaveClass(styles.exiting);
    fireEvent.click(screen.getByTestId("confirm-yes"));
    act(() => vi.advanceTimersByTime(160));
    expect(settled).toHaveBeenCalledExactlyOnceWith(2);
  });
});
