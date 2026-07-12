import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import VmwDesktopVmsTab from "./VmwDesktopVmsTab";
import { vmwDesktopVmsApi } from "../../../hooks/integration/vmwareDesktop/useVmwDesktopVms";

const SAMPLE_VM = {
  id: "1",
  vmxPath: "C:/vms/dev/dev.vmx",
  name: "dev",
  powerState: "powered_off",
  guestOs: "ubuntu-64",
  guestOsFamily: "linux",
  numCpus: 2,
  memoryMb: 4096,
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "vmwd_list_vms":
        return Promise.resolve([SAMPLE_VM]);
      default:
        return Promise.resolve(undefined);
    }
  });
});

describe("vmwDesktopVmsApi", () => {
  it("maps invoke argument names to the Rust command params", async () => {
    await vmwDesktopVmsApi.getVm("vmx");
    expect(invokeMock).toHaveBeenCalledWith("vmwd_get_vm", { vmxPath: "vmx" });

    await vmwDesktopVmsApi.batchPower(["a", "b"], "start");
    expect(invokeMock).toHaveBeenCalledWith("vmwd_batch_power", {
      vmxPaths: ["a", "b"],
      action: "start",
    });

    await vmwDesktopVmsApi.execInGuest({
      vmxPath: "vmx",
      guestUser: "u",
      guestPass: "p",
      program: "/bin/ls",
      arguments: ["-la"],
      wait: true,
      interactive: false,
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "vmwd_exec_in_guest",
      expect.objectContaining({
        vmxPath: "vmx",
        guestUser: "u",
        guestPass: "p",
        program: "/bin/ls",
        arguments: ["-la"],
      }),
    );

    await vmwDesktopVmsApi.createSnapshot({
      vmxPath: "vmx",
      name: "snap1",
      captureMemory: true,
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "vmwd_create_snapshot",
      expect.objectContaining({ vmxPath: "vmx", name: "snap1", captureMemory: true }),
    );
  });
});

describe("VmwDesktopVmsTab", () => {
  it("shows the connect hint when disconnected", () => {
    render(<VmwDesktopVmsTab connected={false} summary={null} />);
    expect(
      screen.getByText(/Connect to a VMware Workstation host/i),
    ).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("vmwd_list_vms");
  });

  it("loads the inventory on connect and renders the section bar", async () => {
    render(
      <VmwDesktopVmsTab
        connected
        summary={{
          product: "workstation_pro",
          productVersion: "17.5",
          vmrunAvailable: true,
          vmrestAvailable: true,
          vmCount: 1,
        }}
      />,
    );

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("vmwd_list_vms", undefined),
    );
    expect(await screen.findByText("dev")).toBeInTheDocument();

    // Check the inventory row (first checkbox in DOM), switch to the Power
    // section, and run a batch power op over the selected VM.
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Power$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Run on selected/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "vmwd_batch_power",
        expect.objectContaining({ vmxPaths: [SAMPLE_VM.vmxPath] }),
      ),
    );
  });
});
