import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PerformanceSection from "../../src/components/connectionEditor/rdpOptions/PerformanceSection";
import PerformanceDefaults from "../../src/components/SettingsDialog/sections/rdpDefaults/PerformanceDefaults";
import { DEFAULT_VALUES } from "../../src/components/SettingsDialog/settingsConstants";
import { useRDPOptions } from "../../src/hooks/rdp/useRDPOptions";
import { mergeRdpSettings } from "../../src/utils/rdp/rdpSettingsMerge";
import type { Connection } from "../../src/types/connection/connection";

describe("RDP frame rate controls", () => {
  it("opens legacy connection preferences in inherit mode and requires an explicit limit", () => {
    const update = vi.fn();
    render(
      <PerformanceSection
        rdp={{ performance: { targetFps: 30 } }}
        updateRdp={update}
      />,
    );
    const mode = screen.getByRole("combobox", { name: "Frame rate limit" });
    expect(mode).toHaveTextContent("Inherit from global settings");
    expect(
      screen.queryByRole("spinbutton", { name: "Maximum FPS" }),
    ).not.toBeInTheDocument();
    fireEvent.click(mode);
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Set maximum FPS" }),
    );
    expect(update).toHaveBeenCalledWith("performance", {
      frameRateLimitEnabled: true,
      targetFps: 30,
    });
  });

  it("accepts high refresh caps and permits returning to inheritance", () => {
    const update = vi.fn();
    render(
      <PerformanceSection
        rdp={{ performance: { frameRateLimitEnabled: true, targetFps: 144 } }}
        updateRdp={update}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum FPS" }), {
      target: { value: "240" },
    });
    expect(update).toHaveBeenCalledWith("performance", { targetFps: 240 });
    fireEvent.click(screen.getByRole("combobox", { name: "Frame rate limit" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Inherit from global settings" }),
    );
    expect(update).toHaveBeenCalledWith("performance", {
      frameRateLimitEnabled: undefined,
    });
  });

  it("shows legacy global FPS preferences as uncapped until enabled", () => {
    const update = vi.fn();
    const { container } = render(
      <PerformanceDefaults
        rdp={{
          ...DEFAULT_VALUES.rdpDefaults!,
          frameRateLimitEnabled: undefined,
          targetFps: 30,
        }}
        update={update}
      />,
    );
    expect(
      screen.getByRole("spinbutton", { name: "Maximum FPS" }),
    ).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Maximum FPS" })).toHaveValue(
      0,
    );
    const toggle = container.querySelector(
      '[data-setting-key="frameRateLimitEnabled"] input',
    )!;
    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({
      frameRateLimitEnabled: true,
      targetFps: 30,
    });
  });

  it("does not override global cap inheritance when another performance option is edited", () => {
    const { result } = renderHook(() => {
      const [form, setForm] = useState<Partial<Connection>>({
        protocol: "rdp",
      });
      return { form, options: useRDPOptions(form, setForm) };
    });
    expect(
      result.current.options.rdp.performance?.frameRateLimitEnabled,
    ).toBeUndefined();
    act(() =>
      result.current.options.updateRdp("performance", {
        disableWallpaper: false,
      }),
    );
    const merged = mergeRdpSettings(result.current.form.rdpSettings, {
      frameRateLimitEnabled: true,
      targetFps: 240,
    });
    expect(merged.performance?.targetFps).toBe(240);
    act(() =>
      result.current.options.updateRdp("performance", {
        frameRateLimitEnabled: false,
      }),
    );
    expect(
      mergeRdpSettings(result.current.form.rdpSettings, {
        frameRateLimitEnabled: true,
        targetFps: 240,
      }).performance?.targetFps,
    ).toBe(0);
  });
});
