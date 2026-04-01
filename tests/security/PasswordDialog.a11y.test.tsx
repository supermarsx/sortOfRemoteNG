import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PasswordDialog } from "../../src/components/security/PasswordDialog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(false),
}));

describe("PasswordDialog accessibility", () => {
  it("password input has aria-label", async () => {
    render(
      <PasswordDialog isOpen mode="unlock" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Enter password")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("Enter password")).toHaveAttribute("aria-label", "Password");
  });

  it("confirm password input has aria-label in setup mode", async () => {
    render(
      <PasswordDialog isOpen mode="setup" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Confirm password")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("Confirm password")).toHaveAttribute("aria-label", "Confirm password");
  });

  it("key file selection div has role=button and tabIndex", async () => {
    render(
      <PasswordDialog isOpen mode="setup" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    // Switch to keyfile auth method
    await waitFor(() => {
      expect(screen.getByText("Key File")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Key File"));

    const keyFileButton = screen.getByRole("button", { name: "Select key file" });
    expect(keyFileButton).toBeInTheDocument();
    expect(keyFileButton).toHaveAttribute("tabindex", "0");
  });
});
