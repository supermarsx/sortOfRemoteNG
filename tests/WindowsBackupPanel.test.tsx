import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WindowsBackupPanel } from "../src/components/sync/WindowsBackupPanel";
import { ConnectionProvider } from "../src/contexts/ConnectionContext";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../src/utils/connection/collectionManager", () => ({
  CollectionManager: {
    getInstance: () => ({
      getAllCollections: vi.fn().mockResolvedValue([]),
      getCurrentCollection: vi.fn().mockReturnValue(null),
    }),
    resetInstance: vi.fn(),
  },
}));

vi.mock("../src/utils/settings/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue("dark"),
    }),
  },
}));

vi.mock("../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      sessions: [],
      connections: [],
    },
    dispatch: vi.fn(),
  }),
}));

const mockOnClose = vi.fn();

const renderPanel = (isOpen = true) =>
  render(
    <ConnectionProvider>
      <WindowsBackupPanel isOpen={isOpen} onClose={mockOnClose} />
    </ConnectionProvider>,
  );

// ── Component Tests ────────────────────────────────────────────────

describe("WindowsBackupPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = renderPanel(false);
    expect(container.innerHTML).toBe("");
  });

  it("renders the modal when open", () => {
    renderPanel(true);
    expect(screen.getByTestId("windows-backup-panel-modal")).toBeTruthy();
  });

  it("shows the title", () => {
    renderPanel(true);
    expect(screen.getByText("Windows Backup")).toBeTruthy();
  });

  it("shows the connect form when not connected", () => {
    renderPanel(true);
    expect(screen.getByText("Not Connected")).toBeTruthy();
    expect(screen.getByPlaceholderText("192.168.1.100")).toBeTruthy();
  });

  it("displays hostname input", () => {
    renderPanel(true);
    const input = screen.getByPlaceholderText("192.168.1.100");
    fireEvent.change(input, { target: { value: "server1.local" } });
    expect(input).toHaveValue("server1.local");
  });

  it("shows connect button", () => {
    renderPanel(true);
    expect(screen.getByText("Connect")).toBeTruthy();
  });

  it("connect button is disabled when hostname is empty", () => {
    renderPanel(true);
    const connectBtn = screen.getByText("Connect").closest("button");
    expect(connectBtn).toBeDisabled();
  });

  it("shows connection prompt text", () => {
    renderPanel(true);
    expect(
      screen.getByText(
        "Enter the hostname and credentials for a remote Windows server.",
      ),
    ).toBeTruthy();
  });

  it("renders credential fields", () => {
    renderPanel(true);
    expect(screen.getByPlaceholderText(/DOMAIN/)).toBeTruthy();
  });
});
