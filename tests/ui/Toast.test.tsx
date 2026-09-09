import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  Toast,
  ToastContainer,
  type ToastMessage,
} from "../../src/components/ui/dialogs/Toast";

vi.stubGlobal(
  "requestAnimationFrame",
  (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number,
);
vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders with the correct message", () => {
    const toast: ToastMessage = {
      id: "1",
      type: "success",
      message: "Saved successfully",
    };
    render(<Toast toast={toast} onRemove={vi.fn()} />);
    expect(screen.getByText("Saved successfully")).toBeTruthy();
  });

  it("renders different toast types", () => {
    const types: ToastMessage["type"][] = [
      "success",
      "error",
      "warning",
      "info",
    ];
    for (const type of types) {
      const toast: ToastMessage = { id: type, type, message: `${type} toast` };
      const { unmount } = render(<Toast toast={toast} onRemove={vi.fn()} />);
      expect(screen.getByText(`${type} toast`)).toBeTruthy();
      unmount();
    }
  });

  it("shows close button on hover and clicking it calls onRemove", () => {
    const onRemove = vi.fn();
    const toast: ToastMessage = { id: "2", type: "info", message: "Hover me" };
    render(<Toast toast={toast} onRemove={onRemove} />);

    // The close button exists in the DOM (opacity-0 by default, group-hover:opacity-100)
    const toastEl = screen.getByText("Hover me").closest(".toast-item")!;
    const closeButton = toastEl.querySelector("button")!;
    expect(closeButton).toBeTruthy();

    fireEvent.click(closeButton);
    // After the 250ms exit delay, onRemove is called
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onRemove).toHaveBeenCalledWith("2");
  });

  it("auto-dismisses after the default duration", () => {
    const onRemove = vi.fn();
    const toast: ToastMessage = {
      id: "3",
      type: "success",
      message: "Auto dismiss",
    };
    render(<Toast toast={toast} onRemove={onRemove} />);

    // Default duration is 4000ms, needs rAF ticks
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(onRemove).toHaveBeenCalledWith("3");
  });

  it("auto-dismisses after custom duration", () => {
    const onRemove = vi.fn();
    const toast: ToastMessage = {
      id: "4",
      type: "warning",
      message: "Quick",
      duration: 1000,
    };
    render(<Toast toast={toast} onRemove={onRemove} />);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onRemove).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onRemove).toHaveBeenCalledWith("4");
  });

  it("keeps loading visible without an expiry timer, updates progress, then expires only after completion", () => {
    const onRemove = vi.fn();
    const { rerender } = render(
      <Toast
        toast={{
          id: "job",
          type: "loading",
          message: "Clone: Alpha — 1 of 2",
          progress: { completed: 0, total: 3 },
        }}
        onRemove={onRemove}
      />,
    );
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60000));
    expect(onRemove).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Dismiss notification" }),
    ).toBeNull();
    rerender(
      <Toast
        toast={{
          id: "job",
          type: "loading",
          message: "Saving package…",
          revision: 1,
          progress: { completed: 2, total: 3 },
        }}
        onRemove={onRemove}
      />,
    );
    expect(
      Number(screen.getByRole("progressbar").getAttribute("aria-valuenow")),
    ).toBeLessThan(100);
    expect(vi.getTimerCount()).toBe(0);
    rerender(
      <Toast
        toast={{
          id: "job",
          type: "success",
          message: "Finished",
          revision: 2,
          duration: 1000,
        }}
        onRemove={onRemove}
      />,
    );
    act(() => vi.advanceTimersByTime(600));
    expect(onRemove).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("retains inspectable failure details until dismissed and cancels delayed dismissal on unmount", () => {
    const onRemove = vi.fn();
    const { unmount } = render(
      <Toast
        toast={{
          id: "failed",
          type: "error",
          message: "1 failed",
          duration: 0,
          details: ["Alpha: disk full"],
        }}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("View details (1)")).toBeTruthy();
    expect(screen.getByText("Alpha: disk full")).toBeTruthy();
    act(() => vi.advanceTimersByTime(60000));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(onRemove).not.toHaveBeenCalled();
  });
});

describe("ToastContainer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when toasts array is empty", () => {
    const { container } = render(
      <ToastContainer toasts={[]} onRemove={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders multiple toasts", () => {
    const toasts: ToastMessage[] = [
      { id: "a", type: "success", message: "First toast" },
      { id: "b", type: "error", message: "Second toast" },
      { id: "c", type: "info", message: "Third toast" },
    ];
    render(<ToastContainer toasts={toasts} onRemove={vi.fn()} />);
    expect(screen.getByText("First toast")).toBeTruthy();
    expect(screen.getByText("Second toast")).toBeTruthy();
    expect(screen.getByText("Third toast")).toBeTruthy();
  });

  it("passes onRemove to each toast", () => {
    const onRemove = vi.fn();
    const toasts: ToastMessage[] = [
      { id: "x", type: "info", message: "Removable" },
    ];
    render(<ToastContainer toasts={toasts} onRemove={onRemove} />);

    const toastEl = screen.getByText("Removable").closest(".toast-item")!;
    const closeButton = toastEl.querySelector("button")!;
    fireEvent.click(closeButton);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onRemove).toHaveBeenCalledWith("x");
  });
});
