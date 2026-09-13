import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import YubiKeySecuritySection from "../../src/components/SettingsDialog/sections/security/YubiKeySecuritySection";
describe("hardware-key settings launch", () => {
  it("launches the dedicated tool without duplicating hardware discovery in Settings", () => {
    const open = vi.fn();
    render(<YubiKeySecuritySection onOpen={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage YubiKeys" }));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByText(/does not enroll it with a website/),
    ).toBeInTheDocument();
  });
  it("does not silently open a modal when the host cannot activate tabs", () => {
    render(<YubiKeySecuritySection />);
    expect(
      screen.getByRole("button", { name: "Manage YubiKeys" }),
    ).toBeDisabled();
    expect(screen.getByText(/main application toolbar/)).toBeInTheDocument();
  });
});
