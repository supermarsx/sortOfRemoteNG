import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import VmwarePanel, { vmwareDescriptor } from "./VmwarePanel";
import { vmwareApi } from "../../hooks/integration/useVmware";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "vmware_is_connected":
        return Promise.resolve(false);
      case "vmware_connect":
        return Promise.resolve("session-1");
      case "vmware_get_config":
        return Promise.resolve(null);
      case "vmware_get_inventory_summary":
        return Promise.resolve({
          datacenterCount: 0,
          clusterCount: 0,
          hostCount: 0,
          vmCount: 0,
          vmPoweredOn: 0,
          datastoreCount: 0,
          networkCount: 0,
        });
      case "vmware_get_all_vm_stats":
        return Promise.resolve([]);
      default:
        return Promise.resolve(null);
    }
  });
});

describe("VmwarePanel", () => {
  it("renders the connect form when no backend session exists", async () => {
    render(<VmwarePanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("vcenter.lab.local"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Connect/i }),
    ).toBeInTheDocument();
  });

  it("connect maps to the vmware_connect command with the form values", async () => {
    const { container } = render(<VmwarePanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("vcenter.lab.local"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("vcenter.lab.local"), {
      target: { value: "vcenter.lab.local" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("administrator@vsphere.local"),
      { target: { value: "administrator@vsphere.local" } },
    );
    const pw = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(pw, { target: { value: "hunter2" } });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "vmware_connect",
        expect.objectContaining({
          host: "vcenter.lab.local",
          username: "administrator@vsphere.local",
          password: "hunter2",
          port: 443,
          insecure: true,
        }),
      ),
    );
  });

  it("exposes a well-formed infra descriptor", () => {
    expect(vmwareDescriptor.key).toBe("vmware");
    expect(vmwareDescriptor.category).toBe("infra");
    expect(typeof vmwareDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to the correct command names", () => {
    vmwareApi.listVms();
    vmwareApi.getVm("vm-42");
    vmwareApi.powerOn("vm-42");
    expect(invokeMock).toHaveBeenCalledWith("vmware_list_vms", undefined);
    expect(invokeMock).toHaveBeenCalledWith("vmware_get_vm", { vmId: "vm-42" });
    expect(invokeMock).toHaveBeenCalledWith("vmware_power_on", {
      vmId: "vm-42",
    });
  });
});
