import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProxySettings from "../../src/components/SettingsDialog/sections/ProxySettings";
import WinRMOptions from "../../src/components/connectionEditor/WinRMOptions";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  defaultSSHTerminalConfig,
  mergeSSHTerminalConfig,
} from "../../src/types/ssh/sshSettings";
import {
  clearSessionHistory,
  loadSessionHistory,
  recordRdpSessionHistory,
} from "../../src/utils/rdp/rdpSessionHistory";
import { formatDate } from "../../src/utils/i18n/localeFormat";
import { SettingsManager } from "../../src/utils/settings/settingsManager";

const settingsContextMock = vi.hoisted(() => ({
  current: {
    settings: {},
    updateSettings: vi.fn(),
    reloadSettings: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../src/contexts/SettingsContext", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/contexts/SettingsContext")
  >("../../src/contexts/SettingsContext");
  return {
    ...actual,
    useSettings: () => settingsContextMock.current,
  };
});

describe("settings runtime applicability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SettingsManager.resetInstance();
    localStorage.clear();
    settingsContextMock.current = {
      settings: { ...defaultSettings },
      updateSettings: vi.fn(),
      reloadSettings: vi.fn(),
    };
  });

  it("applies date format, calendar, numbering system, and timezone settings to Intl output", () => {
    const date = new Date("2026-01-02T12:00:00Z");
    const settings = {
      language: "en-US",
      autoDetectOsLanguage: false,
      dateFormat: "long",
      timeZone: "UTC",
      calendarSystem: "islamic",
      numberingSystem: "arab",
    } satisfies Parameters<typeof formatDate>[1];

    expect(formatDate(date, settings)).toBe(
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeZone: "UTC",
        calendar: "islamic",
        numberingSystem: "arab",
      }).format(date),
    );
  });

  it("uses rdpSessionHistoryMax to cap persisted RDP session history", () => {
    SettingsManager.getInstance().applyInMemory({ rdpSessionHistoryMax: 2 });
    clearSessionHistory();

    for (const idx of [1, 2, 3]) {
      recordRdpSessionHistory({
        connectionId: `rdp-${idx}`,
        connectionName: `RDP ${idx}`,
        hostname: `host-${idx}.example.test`,
        port: 3389,
        username: "user",
        lastConnected: `2026-01-0${idx}T00:00:00.000Z`,
        disconnectedAt: `2026-01-0${idx}T00:10:00.000Z`,
        duration: 600,
        desktopWidth: 1920,
        desktopHeight: 1080,
      });
    }

    expect(loadSessionHistory().map((entry) => entry.connectionId)).toEqual([
      "rdp-3",
      "rdp-2",
    ]);
  });

  it("deep-merges global SSH terminal settings with per-connection overrides", () => {
    const globalConfig = {
      ...defaultSSHTerminalConfig,
      useCustomFont: true,
      font: {
        ...defaultSSHTerminalConfig.font,
        family: "Cascadia Mono",
        size: 15,
        lineHeight: 1.25,
      },
      tcpOptions: {
        ...defaultSSHTerminalConfig.tcpOptions,
        tcpNoDelay: false,
        keepAliveInterval: 45,
      },
    };

    const merged = mergeSSHTerminalConfig(globalConfig, {
      font: {
        family: "Cascadia Mono",
        size: 18,
        weight: "normal",
        style: "normal",
        lineHeight: 1.25,
        letterSpacing: 0,
      },
      tcpOptions: {
        tcpNoDelay: true,
        tcpKeepAlive: true,
        soKeepAlive: true,
        ipProtocol: "auto",
        keepAliveInterval: 45,
        keepAliveProbes: 2,
        connectionTimeout: 15,
      },
    });

    expect(merged.font.family).toBe("Cascadia Mono");
    expect(merged.font.size).toBe(18);
    expect(merged.font.lineHeight).toBe(1.25);
    expect(merged.tcpOptions.tcpNoDelay).toBe(true);
    expect(merged.tcpOptions.keepAliveInterval).toBe(45);
  });

  it("saves, applies, and preserves enabled state semantics for global proxy presets", () => {
    const updateSettings = vi.fn();
    const updateProxy = vi.fn();
    const settings = {
      ...defaultSettings,
      globalProxy: {
        enabled: true,
        type: "http",
        host: "corp.proxy.test",
        port: 8080,
        username: "alice",
        password: "secret",
      },
      globalProxyPresets: [],
    } as GlobalSettings;

    const { rerender } = render(
      <ProxySettings
        settings={settings}
        updateSettings={updateSettings}
        updateProxy={updateProxy}
      />,
    );

    fireEvent.change(screen.getByLabelText("New preset name"), {
      target: { value: "Office" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save current/i }));

    expect(updateSettings).toHaveBeenCalledWith({
      globalProxyPresets: [
        expect.objectContaining({
          name: "Office",
          config: {
            type: "http",
            host: "corp.proxy.test",
            port: 8080,
            username: "alice",
            password: "secret",
          },
        }),
      ],
    });

    rerender(
      <ProxySettings
        settings={{
          ...settings,
          globalProxy: {
            enabled: false,
            type: "http",
            host: "home.proxy.test",
            port: 3128,
          },
          globalProxyPresets: [
            {
              id: "preset-office",
              name: "Office",
              config: {
                type: "http",
                host: "corp.proxy.test",
                port: 8080,
                username: "alice",
                password: "secret",
              },
            },
          ],
        }}
        updateSettings={updateSettings}
        updateProxy={updateProxy}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(updateProxy).toHaveBeenCalledWith({
      type: "http",
      host: "corp.proxy.test",
      port: 8080,
      username: "alice",
      password: "secret",
    });
  });

  it("uses global winrmDefaults for new WinRM connection options", () => {
    settingsContextMock.current = {
      settings: {
        ...defaultSettings,
        enableWinrmTools: true,
        winrmDefaults: {
          httpPort: 5590,
          httpsPort: 5591,
          preferSsl: true,
          authMethod: "kerberos",
          skipCaCheck: true,
          skipCnCheck: false,
          autoFallback: false,
          namespace: "root\\coverage",
          timeoutSec: 42,
        },
      },
      updateSettings: vi.fn(),
      reloadSettings: vi.fn(),
    };
    let nextForm: Partial<Connection> | undefined;
    const setFormData = vi.fn((updater) => {
      nextForm =
        typeof updater === "function"
          ? updater({ protocol: "winrm", isGroup: false })
          : updater;
    });

    render(
      <WinRMOptions
        formData={{ protocol: "winrm", isGroup: false }}
        setFormData={setFormData}
      />,
    );

    const spinButtons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(spinButtons[0]).toHaveValue(5590);
    expect(spinButtons[1]).toHaveValue(5591);
    expect(screen.getByDisplayValue("root\\coverage")).toBeInTheDocument();

    fireEvent.change(spinButtons[0], { target: { value: "5592" } });

    expect(nextForm?.winrmSettings).toMatchObject({
      httpPort: 5592,
      httpsPort: 5591,
      preferSsl: true,
      authMethod: "kerberos",
      namespace: "root\\coverage",
      timeoutSec: 42,
    });
  });

  it("adapts WinRM options to the requested logical section", () => {
    render(
      <WinRMOptions
        formData={{ protocol: "winrm", isGroup: false }}
        setFormData={vi.fn()}
        sections={["transport"]}
      />,
    );

    expect(screen.getAllByRole("spinbutton")).toHaveLength(3);
    expect(screen.queryByText("Enable WinRM Tools")).not.toBeInTheDocument();
    expect(screen.queryByText("Domain")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("root\\cimv2")).not.toBeInTheDocument();
  });
});
