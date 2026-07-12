import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import VmwareDesktopPanel, { vmwareDesktopDescriptor } from "./VmwareDesktopPanel";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "vmwd_connect":
        return Promise.resolve({
          product: "workstation_pro",
          productVersion: "17.5",
          vmrunAvailable: true,
          vmrestAvailable: true,
          vmCount: 3,
        });
      case "vmwd_host_info":
        return Promise.resolve({
          product: "workstation_pro",
          vmrestAvailable: true,
          os: "windows",
          networkTypes: [],
        });
      default:
        return Promise.resolve(undefined);
    }
  });
  (
    globalThis as unknown as {
      __TAURI__?: { core: { invoke: typeof invokeMock } };
    }
  ).__TAURI__ = {
    core: {
      invoke: ((cmd: string, args?: Record<string, unknown>) =>
        invokeMock(cmd, args)) as unknown as typeof invokeMock,
    },
  };
});

describe("VmwareDesktopPanel", () => {
  it("exports an infra-category descriptor keyed vmwareDesktop", () => {
    expect(vmwareDesktopDescriptor.key).toBe("vmwareDesktop");
    expect(vmwareDesktopDescriptor.category).toBe("infra");
    expect(typeof vmwareDesktopDescriptor.importPanel).toBe("function");
  });

  it("connect maps to the vmwd_connect command with the skip-TLS toggle", async () => {
    render(<VmwareDesktopPanel isOpen onClose={() => {}} />);

    // Toggle skip-TLS on so we can assert it flows into the connect args.
    const skipTls = screen.getByRole("checkbox", {
      name: /Skip TLS verification/i,
    });
    fireEvent.click(skipTls);

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/ }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "vmwd_connect",
        expect.objectContaining({
          vmrestHost: "127.0.0.1",
          vmrestPort: 8697,
          vmrestSkipTlsVerify: true,
        }),
      ),
    );

    // Reaches the connected state (status pill flips to "Connected").
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });
});
