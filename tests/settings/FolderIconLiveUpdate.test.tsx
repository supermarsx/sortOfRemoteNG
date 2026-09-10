import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsProvider,
  useSettings,
} from "../../src/contexts/SettingsContext";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { useSettingsDialog } from "../../src/hooks/settings/useSettingsDialog";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import { ConnectionTree } from "../../src/components/connection/ConnectionTree";
import type { Connection } from "../../src/types/connection/connection";

vi.unmock("../../src/contexts/SettingsContext");
const mocks = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  invoke: vi.fn(),
  writeGate: null as Promise<void> | null,
  success: vi.fn(),
  error: vi.fn(),
  i18n: { language: "en-US", changeLanguage: vi.fn(async () => undefined) },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
  emit: async () => {},
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "fixture" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: mocks.i18n,
  }),
}));
vi.mock("../../src/i18n", () => ({
  loadLanguage: async () => {},
  resolveSupportedLanguage: () => "en-US",
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { success: mocks.success, error: mocks.error },
  }),
}));

const folder: Connection = {
  id: "fixture-folder",
  name: "Visible folder",
  hostname: "",
  port: 22,
  protocol: "ssh",
  isGroup: true,
  expanded: true,
  favorite: true,
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
};
const context: ConnectionContextType = {
  state: {
    connections: [folder],
    sessions: [],
    selectedConnection: null,
    selectedConnectionIds: new Set(),
    filter: {
      searchTerm: "",
      protocols: [],
      tags: [],
      colorTags: [],
      showRecent: false,
      showFavorites: false,
    },
    isLoading: false,
    sidebarCollapsed: false,
    tabGroups: [],
  },
  dispatch: vi.fn(),
  dispatchAndFlush: vi.fn(async () => {}),
  persistence: { dirty: false, saving: false, error: null },
  saveData: async () => {},
  flushPendingSave: async () => {},
  loadData: async () => true,
  databaseAvailability: {
    status: "ready",
    databaseId: "fixture",
    generation: 1,
  },
};
function Fixture() {
  const settings = useSettings();
  const dialog = useSettingsDialog(true, () => {}, "theme");
  return (
    <>
      <output data-testid="ready">{String(settings.settingsReady)}</output>
      <button
        onClick={() =>
          void dialog.updateSettings({
            folderIconColorMode: "custom",
            folderIconCustomColor: "#123456",
          })
        }
      >
        Custom
      </button>
      <button
        onClick={() =>
          void dialog.updateSettings({ folderIconColorMode: "accent" })
        }
      >
        Accent
      </button>
      <button
        onClick={() =>
          void dialog.updateSettings({ folderIconColorMode: "default" })
        }
      >
        Default
      </button>
      <button onClick={() => void dialog.handleSave()}>Save</button>
      <input
        aria-label="Sidebar width draft"
        type="number"
        value={dialog.settings?.sidebarWidth ?? 0}
        onChange={(event) =>
          void dialog.updateSettings({
            sidebarWidth: Number(event.target.value),
          })
        }
      />
      <ConnectionTree
        onConnect={() => {}}
        onDisconnect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </>
  );
}
beforeEach(() => {
  SettingsManager.resetInstance();
  vi.clearAllMocks();
  mocks.writeGate = null;
  mocks.stored = {
    animationDuration: 0,
    settingsDialog: {
      autoSave: false,
      showSaveButton: true,
      confirmBeforeReset: true,
    },
  };
  let generation = 0;
  mocks.invoke.mockImplementation(
    async (command: string, args?: { patch?: Record<string, unknown> }) => {
      if (command === "read_app_settings") return structuredClone(mocks.stored);
      if (command === "write_app_settings") {
        if (mocks.writeGate) await mocks.writeGate;
        mocks.stored = { ...mocks.stored, ...args?.patch };
        return ++generation;
      }
      return null;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mounted() {
  return render(
    <SettingsProvider>
      <ConnectionContext.Provider value={context}>
        <Fixture />
      </ConnectionContext.Provider>
    </SettingsProvider>,
  );
}
async function ready() {
  await waitFor(() =>
    expect(screen.getByTestId("ready")).toHaveTextContent("true"),
  );
}
const folderIcon = (container: HTMLElement) =>
  container.querySelector(
    '[data-connection-id="fixture-folder"] svg[aria-label]',
  ) as SVGElement;

describe("folder appearance saved settings propagation", () => {
  it.each([false, true])(
    "updates the mounted tree after saving (legacy nested settings: %s)",
    async (legacy) => {
      if (legacy) mocks.stored.settingsDialog = { autoSave: false };
      const { container } = mounted();
      await ready();
      const icon = folderIcon(container);
      expect(icon.style.color).toBe("var(--color-warning)");
      for (const [mode, expected] of [
        ["Custom", "rgb(18, 52, 86)"],
        ["Accent", "var(--color-primary)"],
        ["Default", "var(--color-warning)"],
      ]) {
        fireEvent.click(screen.getByRole("button", { name: mode }));
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Save" }));
        });
        await waitFor(() => expect(icon.style.color).toBe(expected));
        expect(
          container.querySelector(
            '[data-connection-id="fixture-folder"] svg[aria-label]',
          ),
        ).toBe(icon);
      }
      expect(mocks.error).not.toHaveBeenCalled();
      expect(
        SettingsManager.getInstance().getSettings().settingsDialog?.autoSave,
      ).toBe(false);
      expect(
        SettingsManager.getInstance().getSettings().animationDuration,
      ).toBe(0);
      expect(container.querySelector("svg.lucide-star")).toHaveClass(
        "text-warning",
      );
    },
  );

  it("publishes automatic color saves only after persistence while preserving the mounted icon", async () => {
    mocks.stored.settingsDialog = { autoSave: true };
    const { container } = mounted();
    await ready();
    vi.useFakeTimers();
    let release!: () => void;
    mocks.writeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const icon = folderIcon(container);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "write_app_settings",
      expect.objectContaining({
        patch: {
          folderIconColorMode: "custom",
          folderIconCustomColor: "#123456",
        },
      }),
    );
    expect(icon.style.color).toBe("var(--color-warning)");
    await act(async () => {
      release();
    });
    expect(icon.style.color).toBe("rgb(18, 52, 86)");
    expect(folderIcon(container)).toBe(icon);
  });

  it("preserves unrelated dialog drafts and false preferences without weakening external snapshot validation", async () => {
    mocks.stored.settingsDialog = {
      autoSave: false,
      showSaveButton: false,
      confirmBeforeReset: false,
    };
    const { container } = mounted();
    await ready();
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Sidebar width draft" }),
      { target: { value: "345" } },
    );
    const manager = SettingsManager.getInstance();
    await act(async () => {
      await manager.saveSettings({
        folderIconColorMode: "custom",
        folderIconCustomColor: "#123456",
      });
    });
    expect(folderIcon(container).style.color).toBe("rgb(18, 52, 86)");
    expect(
      screen.getByRole("spinbutton", { name: "Sidebar width draft" }),
    ).toHaveValue(345);
    expect(manager.getSettings().settingsDialog).toEqual({
      autoSave: false,
      showSaveButton: false,
      confirmBeforeReset: false,
    });
    expect(manager.getSettings().animationDuration).toBe(0);
    expect(
      manager.applySettingsSnapshot({
        ...manager.getSettings(),
        settingsDialog: { autoSave: false },
      }),
    ).toBeNull();
    expect(
      manager.applySettingsSnapshot({
        ...manager.getSettings(),
        settingsDialog: {
          autoSave: "yes",
          showSaveButton: false,
          confirmBeforeReset: false,
        },
      }),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(mocks.stored.sidebarWidth).toBe(345);
  });
});
