import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), mounted: vi.fn() }));
vi.mock("../../src/utils/runtime/runtimeCapabilities", () => ({
  loadRuntimeCapabilities: mocks.capabilities,
}));
vi.mock("../../src/components/ssh/yubiKey/YubiKeyManager", () => ({
  YubiKeyManager: ({ onClose }: { onClose: () => void }) => {
    mocks.mounted();
    return (
      <div role="dialog" aria-label="YubiKey manager">
        <button onClick={onClose}>Close hardware manager</button>
      </div>
    );
  },
}));
import YubiKeySecuritySection from "../../src/components/SettingsDialog/sections/security/YubiKeySecuritySection";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.capabilities.mockResolvedValue({ source: "native", ops: true });
});
afterEach(cleanup);
describe("hardware-key settings", () => {
  it("does not discover devices or mount the manager until requested", async () => {
    render(<YubiKeySecuritySection />);
    expect(mocks.capabilities).not.toHaveBeenCalled();
    expect(mocks.mounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Manage YubiKeys" }));
    expect(
      await screen.findByRole("dialog", { name: "YubiKey manager" }),
    ).toBeInTheDocument();
    expect(mocks.capabilities).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Close hardware manager" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each([
    { source: "native", ops: false },
    { source: "unavailable", ops: true },
  ])("refuses unverified native support: %j", async (capabilities) => {
    mocks.capabilities.mockResolvedValue(capabilities);
    render(<YubiKeySecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: "Manage YubiKeys" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "full desktop build",
    );
    expect(mocks.mounted).not.toHaveBeenCalled();
  });
  it("does not surface raw errors or secrets from capability detection", async () => {
    mocks.capabilities.mockRejectedValue(new Error("sensitive fixture"));
    render(<YubiKeySecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: "Manage YubiKeys" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to check",
    );
    expect(screen.queryByText(/sensitive fixture/)).not.toBeInTheDocument();
  });
});
