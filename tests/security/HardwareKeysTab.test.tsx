import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), mounted: vi.fn() }));
vi.mock("../../src/utils/runtime/runtimeCapabilities", () => ({
  loadRuntimeCapabilities: mocks.capabilities,
}));
vi.mock("../../src/components/ssh/yubiKey/YubiKeyManager", () => ({
  YubiKeyManager: (props: { embedded?: boolean }) => {
    mocks.mounted(props);
    return <section aria-label="Native hardware manager" />;
  },
}));
import HardwareKeysTab from "../../src/components/security/HardwareKeysTab";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.capabilities.mockResolvedValue({ source: "native", ops: true });
});
describe("hardware tool native capability boundary", () => {
  it("mounts the existing manager embedded only after verified native support", async () => {
    render(<HardwareKeysTab />);
    expect(mocks.mounted).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("region", { name: "Native hardware manager" }),
    ).toBeInTheDocument();
    expect(mocks.mounted).toHaveBeenCalledWith(
      expect.objectContaining({ embedded: true, isOpen: true }),
    );
  });
  it.each([
    { source: "native", ops: false },
    { source: "unavailable", ops: true },
  ])("refuses unavailable support %j", async (capabilities) => {
    mocks.capabilities.mockResolvedValue(capabilities);
    render(<HardwareKeysTab />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "full desktop build",
    );
    expect(mocks.mounted).not.toHaveBeenCalled();
  });
  it("shows generic failures and explicitly retries without exposing native error text", async () => {
    mocks.capabilities.mockRejectedValueOnce(new Error("SECRET_FIXTURE"));
    render(<HardwareKeysTab />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to check",
    );
    expect(screen.queryByText(/SECRET_FIXTURE/)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry hardware support check" }),
    );
    expect(
      await screen.findByRole("region", { name: "Native hardware manager" }),
    ).toBeInTheDocument();
  });
  it("ignores capability replies after the tool closes", async () => {
    let finish!: (value: unknown) => void;
    mocks.capabilities.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<HardwareKeysTab />);
    view.unmount();
    await act(async () => finish({ source: "native", ops: true }));
    expect(mocks.mounted).not.toHaveBeenCalled();
  });
});
