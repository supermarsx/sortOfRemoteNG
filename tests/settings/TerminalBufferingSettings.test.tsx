import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SSHTerminalSettings from "../../src/components/SettingsDialog/sections/SSHTerminalSettings";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  defaultSSHTerminalConfig,
  type SSHTerminalConfig,
} from "../../src/types/ssh/sshSettings";
import {
  defaultTerminalBufferingSettings,
  normalizeTerminalBufferingSettings,
} from "../../src/types/ssh/terminalBuffering";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe("terminal buffering normalization", () => {
  it("defaults to adaptive 1–100 MiB, fixed 50 MiB, and shared 256 MiB", () => {
    expect(defaultTerminalBufferingSettings).toEqual({
      mode: "adaptive",
      minMiB: 1,
      maxMiB: 100,
      fixedMiB: 50,
      totalMiB: 256,
    });
    expect(normalizeTerminalBufferingSettings()).toEqual(
      defaultTerminalBufferingSettings,
    );
    expect(defaultSSHTerminalConfig.outputBuffer).toEqual(
      defaultTerminalBufferingSettings,
    );
    expect(defaultSSHTerminalConfig.outputBuffer).not.toBe(
      defaultTerminalBufferingSettings,
    );
  });

  it.each([null, false, 42, "fixed", [], [1, 100]].map((value) => ({ value })))(
    "falls back for a malformed settings object: $value",
    ({ value }) => {
      expect(normalizeTerminalBufferingSettings(value)).toEqual(
        defaultTerminalBufferingSettings,
      );
    },
  );

  it("rejects non-finite and nonnumeric fields without coercion", () => {
    for (const invalid of [
      undefined,
      null,
      NaN,
      Infinity,
      -Infinity,
      "32",
      "",
      true,
      [],
      {},
    ]) {
      expect(
        normalizeTerminalBufferingSettings({
          mode: invalid,
          minMiB: invalid,
          maxMiB: invalid,
          fixedMiB: invalid,
          totalMiB: invalid,
        }),
      ).toEqual(defaultTerminalBufferingSettings);
    }
  });

  it("fills missing fields independently and accepts only the supported modes", () => {
    expect(normalizeTerminalBufferingSettings({ mode: "fixed" })).toEqual({
      ...defaultTerminalBufferingSettings,
      mode: "fixed",
    });
    expect(
      normalizeTerminalBufferingSettings({ mode: "FIXED", totalMiB: 64 }),
    ).toEqual({ ...defaultTerminalBufferingSettings, totalMiB: 64 });
  });

  it.each([
    { input: -123, session: 1, total: 16 },
    { input: 0, session: 1, total: 16 },
    { input: 32.9, session: 32, total: 32 },
    { input: 1024, session: 100, total: 1024 },
    { input: Number.MAX_VALUE, session: 100, total: 1024 },
  ])("clamps and truncates $input MiB", ({ input, session, total }) => {
    expect(
      normalizeTerminalBufferingSettings({
        minMiB: input,
        maxMiB: input,
        fixedMiB: input,
        totalMiB: input,
      }),
    ).toEqual({
      mode: "adaptive",
      minMiB: session,
      maxMiB: session,
      fixedMiB: session,
      totalMiB: total,
    });
  });

  it("orders the adaptive range without raising the upper ceiling or shared cap", () => {
    expect(
      normalizeTerminalBufferingSettings({
        minMiB: 90,
        maxMiB: 40,
        totalMiB: 16,
      }),
    ).toEqual({
      ...defaultTerminalBufferingSettings,
      minMiB: 40,
      maxMiB: 40,
      totalMiB: 16,
    });
  });

  it("returns an independent, idempotent value without mutating input or defaults", () => {
    const input = Object.freeze({ mode: "fixed", minMiB: 5.5, maxMiB: 70 });
    const result = normalizeTerminalBufferingSettings(input);
    expect(normalizeTerminalBufferingSettings(result)).toEqual(result);
    expect(result).not.toBe(input);
    expect(input.minMiB).toBe(5.5);
    result.fixedMiB = 1;
    expect(defaultTerminalBufferingSettings.fixedMiB).toBe(50);
  });
});

function renderSettings(
  sshTerminal: SSHTerminalConfig = defaultSSHTerminalConfig,
) {
  let settings: GlobalSettings = { ...defaultSettings, sshTerminal };
  const updateSettings = vi.fn((updates: Partial<GlobalSettings>) => {
    settings = { ...settings, ...updates };
    view.rerender(
      <SSHTerminalSettings
        settings={settings}
        updateSettings={updateSettings}
      />,
    );
  });
  const view = render(
    <SSHTerminalSettings settings={settings} updateSettings={updateSettings} />,
  );
  return { ...view, updateSettings, getSettings: () => settings };
}

function selectMode(mode: "Adaptive" | "Fixed") {
  fireEvent.click(screen.getByRole("combobox", { name: "Buffer mode" }));
  fireEvent.mouseDown(screen.getByRole("option", { name: mode }));
}

describe("global SSH output buffer settings", () => {
  it("renders legacy defaults without writing on mount and explains the limits", () => {
    const { outputBuffer: _, ...legacyConfig } = defaultSSHTerminalConfig;
    const { updateSettings } = renderSettings(legacyConfig);

    expect(
      screen.getByRole("combobox", { name: "Buffer mode" }),
    ).toHaveTextContent("Adaptive");
    expect(screen.getByLabelText("Minimum per session (MiB)")).toHaveValue(1);
    expect(screen.getByLabelText("Maximum per session (MiB)")).toHaveValue(100);
    expect(screen.getByLabelText("Shared budget (MiB)")).toHaveValue(256);
    expect(
      screen.queryByLabelText("Fixed target per session (MiB)"),
    ).toBeNull();
    expect(
      screen.getByText(/Global policy for all SSH sessions/),
    ).toHaveTextContent(
      /separate from xterm scrollback lines.*do not preallocate memory/,
    );
    expect(screen.getByText(/memory monitor influences/)).toBeInTheDocument();
    expect(screen.getByText(/shared cap takes priority/)).toHaveTextContent(
      /many sessions.*per-session minimum or fixed target/,
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("persists mode edits under sshTerminal.outputBuffer and preserves terminal settings", () => {
    const cfg = { ...defaultSSHTerminalConfig, scrollbackLines: 1234 };
    const { updateSettings, getSettings, unmount } = renderSettings(cfg);
    selectMode("Fixed");
    expect(updateSettings).toHaveBeenLastCalledWith({
      sshTerminal: {
        ...cfg,
        outputBuffer: { ...defaultTerminalBufferingSettings, mode: "fixed" },
      },
    });
    expect(screen.queryByLabelText("Minimum per session (MiB)")).toBeNull();
    expect(screen.queryByLabelText("Maximum per session (MiB)")).toBeNull();
    expect(screen.getByLabelText("Fixed target per session (MiB)")).toHaveValue(
      50,
    );
    expect(screen.getByText(/fixed target is still subject/)).toHaveTextContent(
      /memory safety pressure and the shared budget cap/,
    );

    fireEvent.change(screen.getByLabelText("Fixed target per session (MiB)"), {
      target: { value: "72" },
    });
    fireEvent.change(screen.getByLabelText("Shared budget (MiB)"), {
      target: { value: "128" },
    });
    expect(updateSettings).toHaveBeenLastCalledWith({
      sshTerminal: {
        ...cfg,
        outputBuffer: {
          ...defaultTerminalBufferingSettings,
          mode: "fixed",
          fixedMiB: 72,
          totalMiB: 128,
        },
      },
    });

    // The callback payload survives a settings serialization and panel remount.
    const saved: GlobalSettings = JSON.parse(JSON.stringify(getSettings()));
    unmount();
    renderSettings(saved.sshTerminal);
    expect(
      screen.getByRole("combobox", { name: "Buffer mode" }),
    ).toHaveTextContent("Fixed");
    expect(screen.getByLabelText("Fixed target per session (MiB)")).toHaveValue(
      72,
    );
    expect(screen.getByLabelText("Shared budget (MiB)")).toHaveValue(128);
    expect(screen.getByLabelText("Scrollback lines")).toHaveValue(1234);
    selectMode("Adaptive");
    expect(screen.getByLabelText("Minimum per session (MiB)")).toHaveValue(1);
    selectMode("Fixed");
    expect(screen.getByLabelText("Fixed target per session (MiB)")).toHaveValue(
      72,
    );
  });

  it("normalizes every numeric edit and preserves inactive mode values", () => {
    const { getSettings } = renderSettings();
    const edit = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });

    edit("Minimum per session (MiB)", "30.9");
    expect(screen.getByLabelText("Minimum per session (MiB)")).toHaveValue(30);
    edit("Maximum per session (MiB)", "20");
    expect(screen.getByLabelText("Minimum per session (MiB)")).toHaveValue(20);
    edit("Maximum per session (MiB)", "500");
    expect(screen.getByLabelText("Maximum per session (MiB)")).toHaveValue(100);
    edit("Shared budget (MiB)", "4096");
    expect(screen.getByLabelText("Shared budget (MiB)")).toHaveValue(1024);
    edit("Shared budget (MiB)", "0");
    expect(screen.getByLabelText("Shared budget (MiB)")).toHaveValue(16);
    selectMode("Fixed");
    edit("Fixed target per session (MiB)", "-2");
    expect(screen.getByLabelText("Fixed target per session (MiB)")).toHaveValue(
      1,
    );
    edit("Fixed target per session (MiB)", "1000");
    expect(screen.getByLabelText("Fixed target per session (MiB)")).toHaveValue(
      100,
    );
    selectMode("Adaptive");
    expect(getSettings().sshTerminal.outputBuffer).toEqual({
      mode: "adaptive",
      minMiB: 20,
      maxMiB: 100,
      fixedMiB: 100,
      totalMiB: 16,
    });
  });

  it("displays malformed saved policy safely and normalizes it on the next edit", () => {
    const { updateSettings } = renderSettings({
      ...defaultSSHTerminalConfig,
      outputBuffer: {
        mode: "adaptive",
        minMiB: 90,
        maxMiB: 30,
        fixedMiB: NaN,
        totalMiB: Infinity,
      },
    });
    expect(screen.getByLabelText("Minimum per session (MiB)")).toHaveValue(30);
    expect(screen.getByLabelText("Maximum per session (MiB)")).toHaveValue(30);
    expect(screen.getByLabelText("Shared budget (MiB)")).toHaveValue(256);
    expect(updateSettings).not.toHaveBeenCalled();
    selectMode("Fixed");
    expect(updateSettings).toHaveBeenLastCalledWith({
      sshTerminal: {
        ...defaultSSHTerminalConfig,
        outputBuffer: {
          mode: "fixed",
          minMiB: 30,
          maxMiB: 30,
          fixedMiB: 50,
          totalMiB: 256,
        },
      },
    });
  });
});
