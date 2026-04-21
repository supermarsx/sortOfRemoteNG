import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PasswordDialog } from "../../src/components/security/PasswordDialog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(false),
}));

describe("PasswordDialog", () => {
  it("shows validation message for short passwords", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(
      <PasswordDialog
        isOpen
        mode="unlock"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    // Wait for the async useEffect (passkey availability check) to settle
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Enter password")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Enter password");
    fireEvent.change(input, { target: { value: "abc" } });
    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(
      screen.getByText("Password must be at least 4 characters"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
