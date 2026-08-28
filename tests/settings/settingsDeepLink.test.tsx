import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import {
  SettingsDialog,
  SettingsTabContent,
} from "../../src/components/SettingsDialog";
import {
  SETTINGS_TABS,
  SETTINGS_TAB_ID_LIST,
} from "../../src/components/SettingsDialog/settingsConstants";
import { BackupStatusPopup } from "../../src/components/sync/BackupStatusPopup";
import { CloudSyncStatusPopup } from "../../src/components/sync/CloudSyncStatusPopup";
import { SyncBackupStatusBar } from "../../src/components/sync/SyncBackupStatusBar";
import { ToastProvider } from "../../src/contexts/ToastContext";

/* ═══════════════════════════════════════════════════════════════
   Settings deep-link (t79)

   "Open Sync & Backup Settings" / "Backup Settings" / "Configure Sync"
   all opened settings on whatever tab happened to be current — there was
   no way for a caller to name a tab. These tests pin the deep link:
   the requested tab wins on every open, not only on first mount.
   ═══════════════════════════════════════════════════════════════ */

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  dispatch: vi.fn(),
  // Stable singletons. Handing back a fresh object per call would retrigger
  // the effects that legitimately depend on manager identity, which spins the
  // dialog in an endless render loop.
  settingsManager: {
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
    applyInMemory: vi.fn(),
    benchmarkKeyDerivation: vi.fn(),
  },
  themeManager: {
    applyTheme: vi.fn(),
    getAvailableThemes: () => ["dark", "light", "auto"],
    getAvailableColorSchemes: () => ["blue"],
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ dispatch: mocks.dispatch }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => mocks.settingsManager },
}));

vi.mock("../../src/utils/settings/themeManager", () => ({
  ThemeManager: { getInstance: () => mocks.themeManager },
}));

/* Only the tabs these tests visit need a stub. */
vi.mock("../../src/components/SettingsDialog/sections/GeneralSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-general" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/BackupSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-backup" />,
}));
vi.mock(
  "../../src/components/SettingsDialog/sections/CloudSyncSettings",
  () => ({
    __esModule: true,
    default: () => <div data-testid="section-cloudsync" />,
  }),
);
vi.mock("../../src/components/SettingsDialog/sections/ThemeSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-theme" />,
}));

beforeAll(() => {
  mocks.settingsManager.loadSettings.mockResolvedValue({});
  mocks.settingsManager.saveSettings.mockResolvedValue(undefined);
  mocks.settingsManager.benchmarkKeyDerivation.mockResolvedValue(1000);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = vi.fn();
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const renderDialog = (props: React.ComponentProps<typeof SettingsDialog>) =>
  render(
    <ToastProvider>
      <SettingsDialog {...props} />
    </ToastProvider>,
  );

describe("settings tab id list", () => {
  it("mirrors the tabs the sidebar renders", () => {
    // SETTINGS_TAB_ID_LIST is the typed deep-link surface written out beside
    // SETTINGS_TABS (which stays `id: string` for the search drift guard).
    // If a tab is added or removed, both must move together.
    expect([...SETTINGS_TAB_ID_LIST]).toEqual(SETTINGS_TABS.map((t) => t.id));
  });
});

describe("SettingsDialog deep link", () => {
  it("opens on the requested tab", async () => {
    renderDialog({ isOpen: true, onClose: () => {}, initialTab: "backup" });

    expect(await screen.findByTestId("section-backup")).toBeInTheDocument();
    expect(screen.queryByTestId("section-general")).not.toBeInTheDocument();
  });

  it("opens on the default tab when no tab is requested", async () => {
    renderDialog({ isOpen: true, onClose: () => {} });

    expect(await screen.findByTestId("section-general")).toBeInTheDocument();
    expect(screen.queryByTestId("section-backup")).not.toBeInTheDocument();
  });

  it("lands on the new tab when reopened from a different button", async () => {
    const { rerender } = renderDialog({
      isOpen: true,
      onClose: () => {},
      initialTab: "backup",
    });
    await screen.findByTestId("section-backup");

    // Close, then reopen from the cloud-sync affordance.
    rerender(
      <ToastProvider>
        <SettingsDialog isOpen={false} onClose={() => {}} initialTab="backup" />
      </ToastProvider>,
    );
    rerender(
      <ToastProvider>
        <SettingsDialog isOpen onClose={() => {}} initialTab="cloudSync" />
      </ToastProvider>,
    );

    expect(await screen.findByTestId("section-cloudsync")).toBeInTheDocument();
    expect(screen.queryByTestId("section-backup")).not.toBeInTheDocument();
  });

  it("switches tab when a new request arrives while already open", async () => {
    const { rerender } = renderDialog({
      isOpen: true,
      onClose: () => {},
      initialTab: "backup",
    });
    await screen.findByTestId("section-backup");

    rerender(
      <ToastProvider>
        <SettingsDialog isOpen onClose={() => {}} initialTab="cloudSync" />
      </ToastProvider>,
    );

    expect(await screen.findByTestId("section-cloudsync")).toBeInTheDocument();
  });

  it("keeps a manually chosen tab when nothing new is requested", async () => {
    const { rerender } = renderDialog({
      isOpen: true,
      onClose: () => {},
      initialTab: "backup",
      initialTabNonce: 1,
    });
    await screen.findByTestId("section-backup");

    fireEvent.click(screen.getByTestId("settings-tab-theme"));
    expect(await screen.findByTestId("section-theme")).toBeInTheDocument();

    // A re-render with the identical request must not yank the user back.
    rerender(
      <ToastProvider>
        <SettingsDialog
          isOpen
          onClose={() => {}}
          initialTab="backup"
          initialTabNonce={1}
        />
      </ToastProvider>,
    );

    expect(screen.getByTestId("section-theme")).toBeInTheDocument();
  });

  it("re-applies the same tab when the request nonce is bumped", async () => {
    const { rerender } = renderDialog({
      isOpen: true,
      onClose: () => {},
      initialTab: "backup",
      initialTabNonce: 1,
    });
    await screen.findByTestId("section-backup");

    fireEvent.click(screen.getByTestId("settings-tab-theme"));
    await screen.findByTestId("section-theme");

    // Same button clicked again: the nonce is what makes it re-navigate.
    rerender(
      <ToastProvider>
        <SettingsDialog
          isOpen
          onClose={() => {}}
          initialTab="backup"
          initialTabNonce={2}
        />
      </ToastProvider>,
    );

    expect(await screen.findByTestId("section-backup")).toBeInTheDocument();
  });
});

describe("SettingsTabContent deep link", () => {
  // The settings *tab* is the surface the app actually opens, and it stays
  // mounted, so it must react to a request that arrives after mount.
  it("opens on the requested tab and follows later requests", async () => {
    const { rerender } = render(
      <ToastProvider>
        <SettingsTabContent
          onClose={() => {}}
          initialTab="cloudSync"
          initialTabNonce={1}
        />
      </ToastProvider>,
    );

    expect(await screen.findByTestId("section-cloudsync")).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <SettingsTabContent
          onClose={() => {}}
          initialTab="backup"
          initialTabNonce={2}
        />
      </ToastProvider>,
    );

    expect(await screen.findByTestId("section-backup")).toBeInTheDocument();
  });

  it("keeps the default tab when nothing is requested", async () => {
    render(
      <ToastProvider>
        <SettingsTabContent onClose={() => {}} />
      </ToastProvider>,
    );

    expect(await screen.findByTestId("section-general")).toBeInTheDocument();
  });
});

describe("sync & backup affordances request their own tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "backup_get_status")
        return { isRunning: false, backupCount: 0, totalSizeBytes: 0 };
      if (command === "backup_list") return [];
      return null;
    });
  });

  it("BackupStatusPopup opens the backup tab", async () => {
    const onOpenSettings = vi.fn();
    render(<BackupStatusPopup onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByTitle("Backup Status"));
    await waitFor(() =>
      expect(screen.getByTestId("backup-status-popover")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("backup-open-settings"));
    expect(onOpenSettings).toHaveBeenCalledWith("backup");
  });

  it("CloudSyncStatusPopup opens the cloudSync tab from both affordances", async () => {
    const onOpenSettings = vi.fn();
    render(<CloudSyncStatusPopup onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByTitle("Cloud Sync Status"));
    await waitFor(() =>
      expect(
        screen.getByTestId("cloud-sync-status-popover"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("cloud-sync-open-settings"));
    // The "Configure Sync" call to action in the empty state — the button the
    // user reported — must reach the same tab.
    fireEvent.click(screen.getByTestId("cloud-sync-configure"));

    expect(onOpenSettings).toHaveBeenCalledTimes(2);
    expect(onOpenSettings).toHaveBeenNthCalledWith(1, "cloudSync");
    expect(onOpenSettings).toHaveBeenNthCalledWith(2, "cloudSync");
  });

  it("SyncBackupStatusBar sends each section to its own tab", async () => {
    const onOpenSettings = vi.fn();
    render(<SyncBackupStatusBar onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByTitle("Sync & Backup Status"));
    await waitFor(() =>
      expect(
        screen.getByTestId("sync-backup-status-popover"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("sync-bar-open-cloud-sync-settings"));
    expect(onOpenSettings).toHaveBeenLastCalledWith("cloudSync");

    fireEvent.click(screen.getByTestId("sync-bar-open-backup-settings"));
    expect(onOpenSettings).toHaveBeenLastCalledWith("backup");

    // The combined footer link covers both sections, so it stays generic —
    // and must not leak the click event in place of a tab id.
    fireEvent.click(screen.getByTestId("sync-bar-open-settings"));
    expect(onOpenSettings).toHaveBeenLastCalledWith();
  });
});
