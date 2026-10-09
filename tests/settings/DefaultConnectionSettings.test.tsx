import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultConnectionSettings } from "../../src/components/SettingsDialog/sections/DefaultConnectionSettings";
import {
  DEFAULT_VALUES,
  TAB_DEFAULTS,
} from "../../src/components/SettingsDialog/settingsConstants";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { useQuickConnect } from "../../src/hooks/connection/useQuickConnect";
import {
  DEFAULT_CONNECTION_PROTOCOLS,
  normalizeDefaultConnectionProtocol,
} from "../../src/utils/connection/defaultConnectionProtocol";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";

const preference = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("../../src/contexts/SettingsContext", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/contexts/SettingsContext")>();
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        ...actual.defaultSettings,
        defaultConnectionProtocol: preference.value,
      },
    }),
  };
});

beforeEach(() => {
  preference.value = undefined;
});

describe("default connection settings", () => {
  it.each([undefined, null, "browser", "unknown", {}, 80])(
    "uses HTTPS for an absent or invalid preference %j",
    (value) => {
      expect(normalizeDefaultConnectionProtocol(value)).toBe("https");
    },
  );

  it("keeps initial context and General reset defaults aligned", () => {
    expect(defaultSettings.defaultConnectionProtocol).toBe("https");
    expect(DEFAULT_VALUES.defaultConnectionProtocol).toBe("https");
    expect(TAB_DEFAULTS.general).toContain("defaultConnectionProtocol");
  });

  it("renders themed Browser and HTTPS defaults with a searchable anchor", () => {
    const { container } = render(
      <DefaultConnectionSettings
        settings={defaultSettings}
        updateSettings={vi.fn()}
      />,
    );
    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveTextContent("Browser");
    expect(selects[1]).toHaveTextContent(/^HTTPS$/);
    for (const select of selects)
      expect(select.className).toContain("sor-settings-select");
    expect(
      container.querySelector('[data-setting-key="defaultConnectionProtocol"]'),
    ).not.toBeNull();
    for (const query of [
      "default connection",
      "default browser protocol",
      "quick connect",
    ]) {
      expect(
        matchSettingsEntries(SETTINGS_SEARCH_INDEX, query).map(
          (entry) => entry.key,
        ),
      ).toContain("defaultConnectionProtocol");
    }
  });

  it("persists only the selected preference, with one Browser choice", () => {
    const update = vi.fn();
    render(
      <DefaultConnectionSettings
        settings={defaultSettings}
        updateSettings={update}
      />,
    );
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    expect(screen.getAllByRole("option", { name: "Browser" })).toHaveLength(1);
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "SSH (Secure Shell)" }),
    );
    expect(update).toHaveBeenCalledExactlyOnceWith({
      defaultConnectionProtocol: "ssh",
    });
  });

  it("keeps explicit HTTP when reselecting Browser", () => {
    const update = vi.fn();
    render(
      <DefaultConnectionSettings
        settings={{ ...defaultSettings, defaultConnectionProtocol: "http" }}
        updateSettings={update}
      />,
    );
    expect(screen.getAllByRole("combobox")[1]).toHaveTextContent(/^HTTP$/);
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.mouseDown(screen.getByRole("option", { name: "Browser" }));
    expect(update).toHaveBeenCalledExactlyOnceWith({
      defaultConnectionProtocol: "http",
    });
  });

  it("makes Browser transport configurable without editing saved connections", () => {
    const update = vi.fn();
    render(
      <DefaultConnectionSettings
        settings={defaultSettings}
        updateSettings={update}
      />,
    );
    fireEvent.click(screen.getAllByRole("combobox")[1]);
    fireEvent.mouseDown(screen.getByRole("option", { name: "HTTP" }));
    expect(update).toHaveBeenCalledExactlyOnceWith({
      defaultConnectionProtocol: "http",
    });
  });
});

describe("Quick Connect preference ownership", () => {
  const options = () => ({
    isOpen: true,
    onClose: vi.fn(),
    historyEnabled: true,
    history: [],
    onClearHistory: vi.fn(),
    onConnect: vi.fn(),
  });

  it.each(DEFAULT_CONNECTION_PROTOCOLS)(
    "uses configured %s for a fresh draft",
    (protocol) => {
      preference.value = protocol;
      const { result } = renderHook(() => useQuickConnect(options()));
      expect(result.current.protocol).toBe(protocol);
    },
  );

  it("applies late-loaded settings to an untouched draft", () => {
    const { result, rerender } = renderHook(() => useQuickConnect(options()));
    expect(result.current.protocol).toBe("https");
    preference.value = "ssh";
    rerender();
    expect(result.current.protocol).toBe("ssh");
  });

  it("preserves an explicitly selected type across settings updates", () => {
    const { result, rerender } = renderHook(() => useQuickConnect(options()));
    act(() => result.current.setProtocol("http"));
    preference.value = "rdp";
    rerender();
    expect(result.current.protocol).toBe("http");
  });

  it("does not switch protocols underneath an entered address", () => {
    const { result, rerender } = renderHook(() => useQuickConnect(options()));
    act(() => result.current.setHostname("portal.example.test"));
    preference.value = "ssh";
    rerender();
    expect(result.current.protocol).toBe("https");
  });

  it("preserves history even after clearing its address", () => {
    const { result, rerender } = renderHook(() => useQuickConnect(options()));
    act(() =>
      result.current.handleHistorySelect({
        protocol: "http",
        hostname: "history.example.test",
      }),
    );
    act(() => result.current.setHostname(""));
    preference.value = "ssh";
    rerender();
    expect(result.current.protocol).toBe("http");
  });

  it("honors a URL scheme and resets the next draft to the current preference", () => {
    const props = options();
    const { result, rerender } = renderHook(() => useQuickConnect(props));
    act(() => result.current.setHostname("http://portal.example.test/login"));
    preference.value = "rdp";
    rerender();
    act(() =>
      result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent),
    );
    expect(props.onConnect).toHaveBeenCalledExactlyOnceWith({
      hostname: "portal.example.test",
      protocol: "http",
    });
    expect(result.current.protocol).toBe("rdp");
    expect(result.current.hostname).toBe("");
  });
});
