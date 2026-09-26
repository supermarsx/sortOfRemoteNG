import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ConfirmDialog } from "../../src/components/ui/dialogs/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders and confirms action", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog isOpen message="Confirm?" onConfirm={onConfirm} />);
    expect(screen.getByText("Confirm?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("OK"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("handles cancel action", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        message="Are you sure?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders custom title", () => {
    render(
      <ConfirmDialog
        isOpen
        title="Custom Title"
        message="Test message"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("Custom Title")).toBeInTheDocument();
  });

  it("renders default title when not provided", () => {
    render(
      <ConfirmDialog isOpen message="Test message" onConfirm={() => {}} />,
    );
    expect(screen.getByText("Confirmation")).toBeInTheDocument();
  });

  it("renders custom confirm text", () => {
    render(
      <ConfirmDialog
        isOpen
        message="Test message"
        confirmText="Yes, Delete"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("Yes, Delete")).toBeInTheDocument();
  });

  it("renders custom cancel text", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        message="Test message"
        cancelText="No, Go Back"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("No, Go Back")).toBeInTheDocument();
  });

  it("applies danger variant styling", () => {
    render(
      <ConfirmDialog
        isOpen
        message="Delete item?"
        variant="danger"
        onConfirm={() => {}}
      />,
    );
    const confirmButton = screen.getByText("OK");
    expect(confirmButton).toHaveClass("bg-error");
  });

  it("applies warning variant styling", () => {
    render(
      <ConfirmDialog
        isOpen
        message="Warning message"
        variant="warning"
        onConfirm={() => {}}
      />,
    );
    const confirmButton = screen.getByText("OK");
    expect(confirmButton).toHaveClass("bg-warning");
  });

  it("applies default variant styling", () => {
    render(
      <ConfirmDialog
        isOpen
        message="Regular message"
        variant="default"
        onConfirm={() => {}}
      />,
    );
    const confirmButton = screen.getByText("OK");
    expect(confirmButton).toHaveClass("bg-primary");
  });

  it("does not render when closed", () => {
    render(
      <ConfirmDialog
        isOpen={false}
        message="Should not see this"
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText("Should not see this")).not.toBeInTheDocument();
  });

  it("renders the optional confirmation toast without a modal backdrop or fade", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Close tab?"
        message="The session will be disconnected."
        onConfirm={onConfirm}
        onCancel={onCancel}
        presentation="toast"
      />,
    );

    const toast = screen.getByTestId("confirm-dialog");
    expect(toast).toHaveClass("sor-modal-toast-backdrop");
    expect(toast).toHaveAttribute("data-presentation", "toast");
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-modal");

    fireEvent.click(screen.getByTestId("confirm-no"));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("handles Enter key press to confirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        message="Press Enter to confirm"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalled();
  });

  it.each(["confirm-no", "confirm-secondary", "confirm-yes"])(
    "lets focused %s own Enter without a second confirmation",
    (testId) => {
      const onConfirm = vi.fn(),
        onCancel = vi.fn(),
        onSecondary = vi.fn();
      render(
        <ConfirmDialog
          isOpen
          message="Delete?"
          variant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
          secondaryAction={{ label: "Keep connections", onClick: onSecondary }}
        />,
      );
      const button = screen.getByTestId(testId);
      button.focus();
      fireEvent.keyDown(button, { key: "Enter" });
      expect(onConfirm).not.toHaveBeenCalled();
      // JSDOM does not synthesize the browser's native keyboard click.
      fireEvent.click(button);
      expect(onConfirm).toHaveBeenCalledTimes(testId === "confirm-yes" ? 1 : 0);
      expect(onCancel).toHaveBeenCalledTimes(testId === "confirm-no" ? 1 : 0);
      expect(onSecondary).toHaveBeenCalledTimes(
        testId === "confirm-secondary" ? 1 : 0,
      );
    },
  );

  it("ignores repeated and composing Enter presses", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog isOpen message="Delete?" onConfirm={onConfirm} />);
    fireEvent.keyDown(document, { key: "Enter", repeat: true });
    fireEvent.keyDown(document, { key: "Enter", isComposing: true });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("handles Escape key press to cancel", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        message="Press Escape to cancel"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("handles backdrop click to cancel", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        isOpen
        message="Click backdrop to cancel"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".fixed.inset-0");
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalled();
    }
  });

  it("combines all custom props correctly", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Delete Confirmation"
        message="Are you sure you want to delete this item?"
        confirmText="Yes, Delete It"
        cancelText="No, Keep It"
        variant="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Delete Confirmation")).toBeInTheDocument();
    expect(
      screen.getByText("Are you sure you want to delete this item?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Yes, Delete It")).toBeInTheDocument();
    expect(screen.getByText("No, Keep It")).toBeInTheDocument();

    const confirmButton = screen.getByText("Yes, Delete It");
    expect(confirmButton).toHaveClass("bg-error");

    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalled();
  });
});
