import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseUsbId,
  SerialOptions,
} from "../../src/components/connectionEditor/SerialOptions";
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

const formState = () =>
  JSON.parse(screen.getByTestId("serial-form-state").textContent ?? "{}");

const chooseMode = (label: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: "Device selection" }));
  fireEvent.mouseDown(screen.getByRole("option", { name: label }));
};

const scanResult = {
  ports: [
    {
      portName: "COM7",
      portType: "usbSerial",
      description: "USB Serial Port",
      manufacturer: "FTDI",
      vid: 1027,
      pid: 24577,
      serialNumber: "A1B2",
      displayName: "COM7 - FTDI FT232R",
      inUse: false,
    },
  ],
  scanTimeMs: 2,
  totalFound: 1,
};

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

  it("parses USB ids as hex or decimal", () => {
    expect(parseUsbId("0x0403")).toBe(1027);
    expect(parseUsbId("0403")).toBe(1027);
    expect(parseUsbId("1027")).toBe(1027);
    expect(parseUsbId(" 0x6001 ")).toBe(24577);
    expect(parseUsbId("6001")).toBe(6001);
    expect(parseUsbId("ffff")).toBe(65535);
    expect(parseUsbId("")).toBeNull();
    expect(parseUsbId("0xZZ")).toBeNull();
    expect(parseUsbId("12345")).toBe(12345);
    expect(parseUsbId("70000")).toBeNull();
    expect(parseUsbId("0x10000")).toBeNull();
    expect(parseUsbId("-1")).toBeNull();
  });

  it("switches to the first USB device and mirrors the auto hostname", () => {
    render(<Harness sections={["connection"]} />);
    expect(screen.getByLabelText("Device path or port")).toBeRequired();

    chooseMode("First USB serial device");

    expect(formState()).toMatchObject({
      hostname: "auto:first-usb",
      port: 0,
      serialSettings: { portSelection: { mode: "firstUsb" } },
    });
    expect(
      screen.queryByLabelText("Device path or port"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("serial-device-auto-copy")).toHaveTextContent(
      "Resolved each time you connect",
    );
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();

    chooseMode("First detected serial device (USB preferred)");
    expect(formState()).toMatchObject({
      hostname: "auto:first-device",
      serialSettings: { portSelection: { mode: "firstAny" } },
    });
  });

  it("stores parsed VID/PID for match mode and flags invalid hex", () => {
    render(<Harness sections={["connection"]} />);
    chooseMode("First device matching a filter");

    expect(formState()).toMatchObject({
      hostname: "auto:match",
      serialSettings: { portSelection: { mode: "match" } },
    });
    expect(screen.getByTestId("serial-match-filter-hint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Vendor ID (hex)"), {
      target: { value: "0x0403" },
    });
    expect(formState().serialSettings.portSelection).toEqual({
      mode: "match",
      vid: 1027,
      pid: null,
      match: "",
    });
    expect(
      screen.queryByTestId("serial-match-filter-hint"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Product ID (hex)"), {
      target: { value: "zz" },
    });
    expect(screen.getByTestId("serial-match-pid-hint")).toHaveTextContent(
      "Enter a hex id",
    );
    expect(screen.getByLabelText("Product ID (hex)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Product ID (hex)")).toHaveValue("zz");
    expect(formState().serialSettings.portSelection.pid).toBeNull();

    fireEvent.change(screen.getByLabelText("Name contains"), {
      target: { value: "ftdi" },
    });
    expect(formState().serialSettings.portSelection).toMatchObject({
      mode: "match",
      vid: 1027,
      match: "ftdi",
    });
  });

  it("previews the resolved device with the exact command contract", async () => {
    invokeMock.mockResolvedValue(scanResult.ports[0]);
    render(<Harness sections={["connection"]} />);
    chooseMode("First USB serial device");

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const result = await screen.findByTestId("serial-device-preview-result");
    expect(result).toHaveAttribute("role", "status");
    expect(result).toHaveTextContent(
      "Would connect to COM7 - FTDI FT232R right now.",
    );
    expect(invokeMock).toHaveBeenCalledWith("serial_resolve_port", {
      selection: { mode: "firstUsb" },
      portName: null,
    });
  });

  it("shows a not-found preview as an alert and keeps the form", async () => {
    invokeMock.mockRejectedValue(
      "PortNotFound: no USB serial device (seen 1 device: COM1 (native))",
    );
    render(<Harness sections={["connection"]} />);
    chooseMode("First device matching a filter");
    fireEvent.change(screen.getByLabelText("Vendor ID (hex)"), {
      target: { value: "0403" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'No attached device matches "matching device". no USB serial device (seen 1 device: COM1 (native))',
    );
    expect(invokeMock).toHaveBeenCalledWith("serial_resolve_port", {
      selection: { mode: "match", vid: 1027 },
      portName: null,
    });
    expect(screen.getByLabelText("Vendor ID (hex)")).toHaveValue("0403");
    expect(formState().serialSettings.portSelection).toMatchObject({
      mode: "match",
      vid: 1027,
    });
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();
  });

  it("copies VID/PID from a scanned device in match mode", async () => {
    invokeMock.mockResolvedValue(scanResult);
    render(<Harness sections={["connection"]} />);
    chooseMode("First device matching a filter");

    fireEvent.click(screen.getByRole("button", { name: "Scan devices" }));
    const detected = await screen.findByLabelText("Detected serial device");
    expect(
      screen.getByRole("option", { name: "Copy IDs from a detected device…" }),
    ).toBeInTheDocument();

    fireEvent.change(detected, { target: { value: "COM7" } });

    expect(screen.getByLabelText("Vendor ID (hex)")).toHaveValue("0x0403");
    expect(screen.getByLabelText("Product ID (hex)")).toHaveValue("0x6001");
    const state = formState();
    expect(state.serialSettings.portSelection).toEqual({
      mode: "match",
      vid: 1027,
      pid: 24577,
      match: "",
    });
    expect(state.serialSettings.portName).toBe("");
    expect(state.hostname).toBe("auto:match");
  });

  it("restores the typed device path when switching back to fixed", () => {
    render(<Harness sections={["connection"]} />);
    fireEvent.change(screen.getByLabelText("Device path or port"), {
      target: { value: "/dev/ttyUSB0" },
    });
    expect(formState().hostname).toBe("/dev/ttyUSB0");

    chooseMode("First USB serial device");
    expect(formState()).toMatchObject({
      hostname: "auto:first-usb",
      serialSettings: { portName: "/dev/ttyUSB0" },
    });

    chooseMode("Specific device path");
    expect(screen.getByLabelText("Device path or port")).toHaveValue(
      "/dev/ttyUSB0",
    );
    expect(formState()).toMatchObject({
      hostname: "/dev/ttyUSB0",
      serialSettings: {
        portName: "/dev/ttyUSB0",
        portSelection: { mode: "fixed" },
      },
    });
    expect(
      screen.queryByRole("button", { name: "Preview" }),
    ).not.toBeInTheDocument();
  });
});
