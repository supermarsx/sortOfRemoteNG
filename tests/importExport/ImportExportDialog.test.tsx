import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportExport } from "../../src/components/ImportExport";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  exportDatabase: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [
        {
          id: "conn-1",
          name: "Server A",
          protocol: "ssh",
          hostname: "10.0.0.20",
          port: 22,
          username: "root",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    },
    dispatch: mocks.dispatch,
  }),
}));

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: {
      success: mocks.toastSuccess,
      error: mocks.toastError,
    },
  }),
}));

vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "collection-1", name: "Default", isEncrypted: false }),
      getExportableDatabases: vi.fn().mockResolvedValue([
        {
          id: "collection-1",
          name: "Default",
          isEncrypted: false,
          isCurrent: true,
          isUnlocked: true,
          isExportable: true,
        },
      ]),
      readExportableDatabaseSnapshot: vi.fn(),
      exportDatabase: mocks.exportDatabase.mockResolvedValue("[]"),
    }),
  },
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: mocks.logAction,
      getSettings: () => ({}),
    }),
  },
}));

vi.mock("../../src/components/ImportExport/ExportTab", () => ({
  default: ({
    handleExport,
    config,
    onConfigChange,
  }: {
    handleExport: () => void;
    config: {
      format: string;
      scopeMode: string;
      selectedDatabaseIds: string[];
      inclusion: {
        includeConnections: boolean;
        includeCredentials: boolean;
        includeSettings: boolean;
        includeExportMetadata: boolean;
        includeDatabaseMetadata: boolean;
      };
      includePasswords: boolean;
      encrypted: boolean;
      password: string;
    };
    onConfigChange: (update: {
      format?: string;
      scopeMode?: "current" | "selected" | "all";
      selectedDatabaseIds?: string[];
      inclusion?: {
        includeConnections?: boolean;
        includeCredentials?: boolean;
        includeSettings?: boolean;
        includeExportMetadata?: boolean;
        includeDatabaseMetadata?: boolean;
      };
      includePasswords?: boolean;
      encrypted?: boolean;
      password?: string;
    }) => void;
  }) => (
    <div>
      <div data-testid="export-tab-content">export-content</div>
      <div data-testid="export-tab-config">
        {`${config.format}|${config.scopeMode}|${config.selectedDatabaseIds.join(",")}|${String(config.inclusion.includeConnections)}|${String(config.inclusion.includeSettings)}|${String(config.inclusion.includeExportMetadata)}|${String(config.inclusion.includeDatabaseMetadata)}|${String(config.includePasswords)}|${String(config.encrypted)}|${config.password}`}
      </div>
      <button onClick={handleExport}>run-export</button>
      <button onClick={() => onConfigChange({ format: "csv" })}>set-format</button>
      <button onClick={() => onConfigChange({ scopeMode: "all" })}>set-scope</button>
      <button onClick={() => onConfigChange({ selectedDatabaseIds: ["collection-1"] })}>set-databases</button>
      <button onClick={() => onConfigChange({ includePasswords: true })}>
        set-include-passwords
      </button>
      <button onClick={() => onConfigChange({ inclusion: { includeConnections: false, includeSettings: false, includeExportMetadata: false, includeDatabaseMetadata: false } })}>
        set-inclusion
      </button>
      <button onClick={() => onConfigChange({ encrypted: true })}>set-encrypted</button>
      <button onClick={() => onConfigChange({ password: "top-secret" })}>set-password</button>
    </div>
  ),
}));

vi.mock("../../src/components/ImportExport/ImportTab", () => ({
  default: ({ confirmImport }: { confirmImport: () => void | Promise<void> }) => (
    <div data-testid="import-tab-content">
      import-content
      <button onClick={() => void confirmImport()}>confirm-import</button>
    </div>
  ),
}));

describe("ImportExport dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when closed and not embedded", () => {
    render(<ImportExport isOpen={false} onClose={() => {}} />);
    expect(
      screen.queryByText("Import / Export Connections"),
    ).not.toBeInTheDocument();
  });

  it("renders modal content when open", () => {
    render(<ImportExport isOpen onClose={() => {}} />);
    expect(screen.getByText("Import / Export")).toBeInTheDocument();
    expect(screen.getByTestId("export-tab-content")).toBeInTheDocument();
  });

  it("uses the requested initial tab and wires confirmImport into the import tab", () => {
    render(<ImportExport isOpen initialTab="import" onClose={() => {}} />);

    expect(screen.getByTestId("import-tab-content")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "confirm-import" }));

    expect(screen.getByTestId("import-tab-content")).toBeInTheDocument();
  });

  it("switches tabs between export and import", () => {
    render(<ImportExport isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: "Import" }));
    expect(screen.getByTestId("import-tab-content")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));
    expect(screen.getByTestId("export-tab-content")).toBeInTheDocument();
  });

  it("renders the Clone tab panel and disables the action with the only available database picked as source", async () => {
    render(<ImportExport isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: "Clone" }));

    // The CloneTab structure rendered: source + destination
    // sections are present.
    expect(
      screen.getByTestId("clone-source-section"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("clone-destination-section"),
    ).toBeInTheDocument();

    // With only one database in the mock (the current one), the
    // sole eligible source IS the only available target — so the
    // action button has to reject the configuration with a clear
    // disabled state.
    const action = await screen.findByTestId("clone-action-button");
    expect(action).toBeDisabled();
  });

  it("supports keyboard navigation between tabs", () => {
    render(<ImportExport isOpen onClose={() => {}} />);

    const exportTab = screen.getByRole("tab", { name: "Export" });
    const importTab = screen.getByRole("tab", { name: "Import" });

    expect(screen.getByRole("tablist", { name: /import and export tabs/i })).toBeInTheDocument();
    expect(exportTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(exportTab, { key: "ArrowRight" });

    expect(importTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("import-tab-content")).toBeInTheDocument();
  });

  it("supports Home, End, ArrowLeft, and ArrowUp tab navigation", () => {
    render(<ImportExport isOpen onClose={() => {}} />);

    const exportTab = screen.getByRole("tab", { name: "Export" });
    const importTab = screen.getByRole("tab", { name: "Import" });
    // Clone was appended to the tab list — End should land on the
    // last entry, which is now Clone (not Import).
    const cloneTab = screen.getByRole("tab", { name: "Clone" });

    fireEvent.keyDown(exportTab, { key: "End" });
    expect(cloneTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(cloneTab, { key: "Home" });
    expect(exportTab).toHaveAttribute("aria-selected", "true");

    fireEvent.click(importTab);
    fireEvent.keyDown(importTab, { key: "ArrowLeft" });
    expect(exportTab).toHaveAttribute("aria-selected", "true");

    fireEvent.click(importTab);
    fireEvent.keyDown(importTab, { key: "ArrowUp" });
    expect(exportTab).toHaveAttribute("aria-selected", "true");
  });

  it("updates export config through ExportTab callbacks", () => {
    render(<ImportExport isOpen onClose={() => {}} />);

    expect(screen.getByTestId("export-tab-config")).toHaveTextContent(
      "json|current||true|true|true|true|false|false|",
    );

    fireEvent.click(screen.getByRole("button", { name: "set-format" }));
    fireEvent.click(screen.getByRole("button", { name: "set-scope" }));
    fireEvent.click(screen.getByRole("button", { name: "set-databases" }));
    fireEvent.click(
      screen.getByRole("button", { name: "set-include-passwords" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "set-inclusion" }));
    fireEvent.click(screen.getByRole("button", { name: "set-encrypted" }));
    fireEvent.click(screen.getByRole("button", { name: "set-password" }));

    expect(screen.getByTestId("export-tab-config")).toHaveTextContent(
      "csv|all|collection-1|false|false|false|false|true|true|top-secret",
    );
  });

  it("closes on Escape and backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(<ImportExport isOpen onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = document.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders inline when embedded and skips overlay", () => {
    const { container } = render(
      <ImportExport isOpen={false} embedded onClose={() => {}} />,
    );

    expect(
      screen.queryByText("Import / Export Connections"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
    expect(container.querySelector(".sor-modal-backdrop")).toBeNull();
  });
});
