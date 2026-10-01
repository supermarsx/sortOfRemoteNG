import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SyncFrequencySelect from "../../src/components/SettingsDialog/sections/cloudSync/SyncFrequencySelect";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";

afterEach(cleanup);

function renderFrequency(initial: Partial<CloudSyncConfig> = {}) {
  const update = vi.fn();
  function Harness() {
    const [cloudSync, setCloudSync] = useState({
      ...defaultCloudSyncConfig,
      ...initial,
    });
    return (
      <SyncFrequencySelect
        mgr={
          {
            cloudSync,
            updateCloudSync: (patch: Partial<CloudSyncConfig>) => {
              update(patch);
              setCloudSync((current) => ({ ...current, ...patch }));
            },
          } as Mgr
        }
      />
    );
  }
  return { ...render(<Harness />), update };
}

function choose(label: string, index = 0) {
  fireEvent.click(screen.getAllByRole("combobox")[index]);
  fireEvent.mouseDown(screen.getByRole("option", { name: label }));
}

describe("cloud sync frequency controls", () => {
  it("keeps every existing preset and exposes themed custom controls", () => {
    const { container, update } = renderFrequency();
    fireEvent.click(screen.getByRole("combobox"));
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      "Manual Only",
      "Real-time (Instant)",
      "On Save",
      "Every 5 Minutes",
      "Every 15 Minutes",
      "Every 30 Minutes",
      "Every Hour",
      "Once Daily",
      "Custom Interval",
    ]);
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Custom Interval" }),
    );
    expect(update).toHaveBeenLastCalledWith({
      frequency: "custom",
      customIntervalMinutes: 15,
    });
    expect(
      screen.getByRole("spinbutton", { name: "Custom Interval" }),
    ).toHaveValue(15);
    expect(screen.getByRole("spinbutton")).toHaveClass("sor-settings-input");
    expect(container.querySelector("select")).toBeNull();
  });

  it("stores numeric edits and unit changes as minutes and retains them across presets", () => {
    const { update } = renderFrequency({ frequency: "custom" });
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "2" },
    });
    choose("Hours", 1);
    expect(update).toHaveBeenLastCalledWith({ customIntervalMinutes: 120 });
    expect(screen.getByRole("spinbutton")).toHaveValue(2);
    choose("Days", 1);
    expect(update).toHaveBeenLastCalledWith({ customIntervalMinutes: 2880 });
    choose("Once Daily");
    expect(update).toHaveBeenLastCalledWith({ frequency: "daily" });
    expect(screen.queryByRole("spinbutton")).toBeNull();
    choose("Custom Interval");
    expect(update).toHaveBeenLastCalledWith({
      frequency: "custom",
      customIntervalMinutes: 2880,
    });
    expect(screen.getByRole("spinbutton")).toHaveValue(2);
  });

  it.each([
    [17, "Minutes", 17, 10_080],
    [180, "Hours", 3, 168],
    [4320, "Days", 3, 7],
  ])(
    "reopens %i persisted minutes in an exact unit",
    (minutes, unit, amount, max) => {
      renderFrequency({ frequency: "custom", customIntervalMinutes: minutes });
      expect(screen.getAllByRole("combobox")[1]).toHaveTextContent(unit);
      expect(screen.getByRole("spinbutton")).toHaveValue(amount);
      expect(screen.getByRole("spinbutton")).toHaveAttribute("min", "1");
      expect(screen.getByRole("spinbutton")).toHaveAttribute(
        "max",
        String(max),
      );
    },
  );

  it.each([
    [1, 1],
    [60, 60],
    [1440, 1440],
  ])("bounds numeric input in units of %i minutes", (minutes, scale) => {
    const { update } = renderFrequency({
      frequency: "custom",
      customIntervalMinutes: minutes,
    });
    const input = screen.getByRole("spinbutton");
    for (const value of ["", "0", "-2"]) {
      fireEvent.change(input, { target: { value } });
      expect(update).toHaveBeenLastCalledWith({ customIntervalMinutes: scale });
    }
    fireEvent.change(input, { target: { value: "999999999" } });
    expect(update).toHaveBeenLastCalledWith({ customIntervalMinutes: 10_080 });
    fireEvent.change(input, { target: { value: "2.7" } });
    expect(update).toHaveBeenLastCalledWith({
      customIntervalMinutes: 3 * scale,
    });
  });
});
