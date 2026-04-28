import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportExport } from "../../src/components/ImportExport";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  exportCollection: vi.fn(),
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

vi.mock("../../src/utils/connection/collectionManager", () => ({
  CollectionManager: {
    getInstance: () => ({
      getCurrentCollection: () => ({ id: "collection-1" }),
      exportCollection: mocks.exportCollection.mockResolvedValue("[]"),
    }),
  },
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: mocks.logAction,
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
      includePasswords: boolean;
      encrypted: boolean;
      password: string;
    };
    onConfigChange: (update: {
      format?: string;
      includePasswords?: boolean;
      encrypted?: boolean;
      password?: string;
    }) => void;
  }) => (
    <div>
      <div data-testid="export-tab-content">export-content</div>
      <div data-testid="export-tab-config">
        {`${config.format}|${String(config.includePasswords)}|${String(config.encrypted)}|${config.password}`}
      </div>
      <button onClick={handleExport}>run-export</button>
      <button onClick={() => onConfigChange({ format: "csv" })}>set-format</button>
      <button onClick={() => onConfigChange({ includePasswords: true })}>
        set-include-passwords
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
    expect(screen.getByText("Import / Export Connections")).toBeInTheDocument();
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

    fireEvent.keyDown(exportTab, { key: "End" });
    expect(importTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(importTab, { key: "Home" });
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
      "json|false|false|",
    );

    fireEvent.click(screen.getByRole("button", { name: "set-format" }));
    fireEvent.click(
      screen.getByRole("button", { name: "set-include-passwords" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "set-encrypted" }));
    fireEvent.click(screen.getByRole("button", { name: "set-password" }));

    expect(screen.getByTestId("export-tab-config")).toHaveTextContent(
      "csv|true|true|top-secret",
    );
  });

  it("closes on Escape and backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(<ImportExport isOpen onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector(".sor-modal-backdrop");
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
