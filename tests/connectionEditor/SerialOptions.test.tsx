import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SerialOptions } from "../../src/components/connectionEditor/SerialOptions";
import type { Connection } from "../../src/types/connection/connection";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const Harness: React.FC<{
  sections?: readonly ("connection" | "terminal" | "advanced")[];
}> = ({ sections }) => {
  const [formData, setFormData] = useState<Partial<Connection>>({
    protocol: "serial",
    isGroup: false,
  });
  return (
    <>
      <SerialOptions
        formData={formData}
        setFormData={setFormData}
        sections={sections}
      />
      <output data-testid="serial-form-state">
        {JSON.stringify(formData)}
      </output>
    </>
  );
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("SerialOptions", () => {
  it("scans with the exact native contract and persists a detected device", async () => {
    invokeMock.mockResolvedValue({
      ports: [
        {
          portName: "COM7",
          portType: "usb",
          description: "USB console",
          manufacturer: "Example",
          vid: 4660,
          pid: 22136,
          serialNumber: "ABC",
          displayName: "COM7 — USB console",
          inUse: false,
        },
      ],
      scanTimeMs: 4,
      totalFound: 1,
    });
    render(<Harness sections={["connection"]} />);

    expect(screen.getByLabelText("Device path or port")).toHaveValue("");
    expect(screen.getByLabelText("Baud rate")).toHaveValue(9600);
    expect(screen.getByText(/Mark\/Space parity/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Scan devices" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText("Detected serial device"),
      ).toBeInTheDocument(),
    );
    expect(invokeMock).toHaveBeenCalledWith("serial_scan_ports", {
      options: {
        probePorts: false,
        nameFilter: null,
        vidFilter: null,
        pidFilter: null,
        includeVirtual: true,
      },
    });

    fireEvent.change(screen.getByLabelText("Detected serial device"), {
      target: { value: "COM7" },
    });
    const state = JSON.parse(
      screen.getByTestId("serial-form-state").textContent ?? "{}",
    );
    expect(state).toMatchObject({
      hostname: "COM7",
      port: 0,
      serialSettings: {
        version: 1,
        portName: "COM7",
        baudRate: 9600,
        dataBits: "8",
        parity: "none",
        stopBits: "1",
        flowControl: "none",
      },
    });
  });

  it("shows only the requested terminal or advanced surface", () => {
    const { rerender } = render(<Harness sections={["terminal"]} />);

    expect(screen.getByText("Terminal input")).toBeInTheDocument();
    expect(screen.queryByText("Local serial device")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Driver and control defaults"),
    ).not.toBeInTheDocument();

    rerender(<Harness sections={["advanced"]} />);
    expect(screen.getByText("Driver and control defaults")).toBeInTheDocument();
    expect(screen.getByText(/Windows uses COM names/)).toBeInTheDocument();
    expect(screen.queryByText("Terminal input")).not.toBeInTheDocument();
  });

  it("fails the scan visibly while retaining manual device entry", async () => {
    invokeMock.mockRejectedValue(new Error("permission denied"));
    render(<Harness sections={["connection"]} />);

    fireEvent.change(screen.getByLabelText("Device path or port"), {
      target: { value: "/dev/ttyUSB0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Scan devices" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Device scan failed: permission denied",
    );
    expect(screen.getByLabelText("Device path or port")).toHaveValue(
      "/dev/ttyUSB0",
    );
  });
});
