import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/hooks/ssh/useYubiKey", () => ({
  useYubiKey: () => ({
    error: null,
    loading: false,
    selectedDevice: null,
    activeTab: "audit",
    auditEntries: [],
    clearError: vi.fn(),
    setActiveTab: vi.fn(),
    exportDeviceReport: vi.fn(),
    factoryResetAll: vi.fn(),
    getAuditLog: vi.fn(),
  }),
}));
vi.mock("../../src/components/ssh/yubiKey/AuditTab", () => ({
  AuditTab: () => <div>Hardware audit content</div>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
import { YubiKeyManager } from "../../src/components/ssh/yubiKey/YubiKeyManager";
describe("embedded hardware manager", () => {
  it("renders existing controls inside the tab without modal or redundant Close button", () => {
    render(<YubiKeyManager isOpen embedded onClose={vi.fn()} />);
    expect(
      screen.getByRole("region", { name: "Hardware keys" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hardware audit content")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /close/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export Report" }),
    ).toBeDisabled();
  });
  it("preserves the existing modal entry point for external callers", () => {
    render(<YubiKeyManager isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2);
  });
});
