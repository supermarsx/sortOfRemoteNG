import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoveryPresetPanel } from "../../src/components/network/DiscoveryPresetPanel";
import {
  DISCOVERY_SERVICE_PRESETS,
  defaultDiscoveryPorts,
} from "../../src/utils/discovery/discoveryPresets";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";

const initial: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.0/24, 198.51.100.7",
  protocols: ["ssh"],
  customPorts: { ...defaultDiscoveryPorts(), ssh: [2222] },
  portRanges: ["8100-8110"],
  timeout: 2500,
  maxConcurrent: 17,
  maxPortConcurrent: 31,
  absoluteMaxProbes: 37,
  adaptiveConcurrency: false,
  nativeBatchProbes: true,
  maxCpuPercent: 44,
  maxNetworkUtilizationPercent: 51,
  workerLaunchIntervalMs: 90,
  probeLaunchIntervalMs: 5,
  resolveHostnames: true,
  identifyServices: true,
  pingMethod: "tcp",
  pingTimeout: 1300,
  pingPort: 2222,
  scanUnresponsiveHosts: false,
  probeStrategies: { default: ["websocket"], http: ["http"] },
  cacheTTL: 300000,
  hostnameTtl: 300000,
  macTtl: 300000,
};
const modified: NetworkDiscoveryConfig = {
  ...initial,
  ipRange: "203.0.113.9",
  protocols: ["https"],
  customPorts: { ...defaultDiscoveryPorts(), ssh: [2200] },
  portRanges: [],
  maxConcurrent: 8,
  maxCpuPercent: 75,
  pingMethod: "none",
};
const applied = vi.fn();
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [config, setConfig] = useState(initial);
  return (
    <>
      <DiscoveryPresetPanel
        config={config}
        setConfig={setConfig}
        disabled={disabled}
        onApplied={applied}
      />
      <button onClick={() => setConfig(modified)}>Edit scan settings</button>
      <pre data-testid="config">{JSON.stringify(config)}</pre>
    </>
  );
}
const current = () =>
  JSON.parse(
    screen.getByTestId("config").textContent!,
  ) as NetworkDiscoveryConfig;
function choose(label: string | RegExp, combo = "Scan preset") {
  fireEvent.click(screen.getByRole("combobox", { name: combo }));
  fireEvent.mouseDown(screen.getByRole("option", { name: label }));
}
function save(name = "Lab servers") {
  fireEvent.click(
    screen.getByRole("button", { name: "Save current settings" }),
  );
  fireEvent.change(screen.getByLabelText("Preset name"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
}
beforeEach(() => {
  localStorage.clear();
  applied.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("scanner preset panel", () => {
  it("applies All services explicitly without changing scan limits or targets", () => {
    render(<Harness />);
    choose("All services");
    expect(current()).toEqual(initial);
    expect(applied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply preset" }));
    expect(current().protocols).toEqual(
      DISCOVERY_SERVICE_PRESETS.map(({ id }) => id),
    );
    expect(current().portRanges).toEqual([]);
    expect(current().customPorts.ssh).toEqual([22]);
    expect(current().maxCpuPercent).toBe(initial.maxCpuPercent);
    expect(current().ipRange).toBe(initial.ipRange);
    expect(applied).toHaveBeenCalledOnce();
    expect(screen.getByText(/not a scan of all 65,535 ports/)).toBeVisible();
  });

  it("offers common services and useful specialized presets", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Scan preset" }));
    for (const name of [
      "Common services",
      "Windows networks",
      "Linux / Unix",
      "Databases",
      "Hosting panels",
      "Virtualization / containers",
      "iLO / management",
      "NAS / storage",
      "IoT / devices",
    ])
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
  });

  it("saves all settings independently of a database and reloads them without restoring targets by default", async () => {
    const view = render(<Harness />);
    save();
    expect(screen.getByRole("status")).toHaveTextContent("Saved Lab servers.");
    expect(current()).toEqual(initial);
    expect(applied).not.toHaveBeenCalled();
    view.unmount();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Edit scan settings" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Manage presets (1)" }),
      ).toBeInTheDocument(),
    );
    choose(/Lab servers/);
    fireEvent.click(screen.getByRole("button", { name: "Apply preset" }));
    expect(current()).toEqual({ ...initial, ipRange: modified.ipRange });
    expect(
      screen.getByRole("checkbox", { name: "Restore saved targets" }),
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Restore saved targets" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply preset" }));
    expect(current()).toEqual(initial);
  });

  it("renames, explicitly replaces settings, and deletes saved presets without changing current settings", () => {
    render(<Harness />);
    save();
    fireEvent.click(screen.getByRole("button", { name: "Manage presets (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Preset name") as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Lab servers".length);
    fireEvent.change(input, { target: { value: "Lab v2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Renamed preset to Lab v2.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit scan settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace settings" }));
    expect(
      screen.getByText(/Replace “Lab v2” with all current settings/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm replace" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Restore saved targets" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply preset" }));
    expect(current()).toEqual(modified);
    fireEvent.click(screen.getByRole("button", { name: "Delete preset" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Manage presets (1)" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete preset" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(screen.getByText("No saved presets yet.")).toBeVisible();
    expect(current()).toEqual(modified);
    expect(screen.getByRole("button", { name: "Apply preset" })).toBeDisabled();
  });

  it("keeps built-ins read-only and makes a separate editable copy", () => {
    render(<Harness />);
    choose("Common services");
    fireEvent.click(screen.getByRole("button", { name: "Manage presets (0)" }));
    expect(screen.getByText(/Built-in presets are read-only/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Delete preset" }),
    ).not.toBeInTheDocument();
    save("My common services");
    expect(
      screen.getByRole("button", { name: "Delete preset" }),
    ).toBeInTheDocument();
    choose("Common services");
    expect(screen.getByRole("button", { name: "Apply preset" })).toBeEnabled();
  });

  it("disables preset application, editing and saving during a scan, including an already-open editor", () => {
    const view = render(<Harness />);
    save();
    fireEvent.click(
      screen.getByRole("button", { name: "Save current settings" }),
    );
    fireEvent.change(screen.getByLabelText("Preset name"), {
      target: { value: "No mid-scan save" },
    });
    view.rerender(<Harness disabled />);
    for (const name of [
      "Apply preset",
      "Save current settings",
      "Manage presets (1)",
      "Save preset",
    ])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Scan preset" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Preset name")).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Preset name"), { key: "Enter" });
    expect(
      screen.queryByText("Saved No mid-scan save."),
    ).not.toBeInTheDocument();
    expect(applied).not.toHaveBeenCalled();
  });

  it("keeps a failed save draft and reports storage failure instead of success", () => {
    render(<Harness />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage quota exceeded");
    });
    save("Keep my draft");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByLabelText("Preset name")).toHaveValue("Keep my draft");
    expect(screen.queryByText("Saved Keep my draft.")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage presets (0)" }),
    ).toBeInTheDocument();
  });
});
