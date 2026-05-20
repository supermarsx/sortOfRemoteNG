import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImportTab from "../../src/components/ImportExport/ImportTab";
import type {
  ImportFilterState,
  ImportOptions,
  ImportPreviewItem,
  ImportResult,
  ImportSourceMetadata,
} from "../../src/components/ImportExport/types";
import type { Connection } from "../../src/types/connection/connection";

const toastSuccess = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: {
      success: toastSuccess,
    },
  }),
}));

function renderImportTab(overrides?: {
  isProcessing?: boolean;
  importResult?: ImportResult | null;
  importAnalysis?: ImportSourceMetadata | null;
  importFilters?: ImportFilterState;
  importOptions?: ImportOptions;
  previewItems?: ImportPreviewItem[];
  visiblePreviewItems?: ImportPreviewItem[];
  availableProtocols?: string[];
  selectedPreviewIds?: Set<string>;
  selectedCount?: number;
  handleImport?: () => void;
  handleFileSelect?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  confirmImport?: () => void | Promise<void>;
  cancelImport?: () => void;
  updateImportFilters?: (updates: Partial<ImportFilterState>) => void;
  resetImportFilters?: () => void;
  updateImportOptions?: (updates: Partial<ImportOptions>) => void;
  togglePreviewSelection?: (itemId: string) => void;
  selectAllVisiblePreviewItems?: () => void;
  deselectAllVisiblePreviewItems?: () => void;
  selectAllImportablePreviewItems?: () => void;
  detectedFormat?: string;
}) {
  const handleImport = overrides?.handleImport ?? vi.fn<() => void>();
  const handleFileSelect = overrides?.handleFileSelect ?? vi.fn<(event: React.ChangeEvent<HTMLInputElement>) => void>();
  const confirmImport = overrides?.confirmImport ?? vi.fn<() => void | Promise<void>>();
  const cancelImport = overrides?.cancelImport ?? vi.fn<() => void>();
  const updateImportFilters = overrides?.updateImportFilters ?? vi.fn<(updates: Partial<ImportFilterState>) => void>();
  const resetImportFilters = overrides?.resetImportFilters ?? vi.fn<() => void>();
  const updateImportOptions = overrides?.updateImportOptions ?? vi.fn<(updates: Partial<ImportOptions>) => void>();
  const togglePreviewSelection = overrides?.togglePreviewSelection ?? vi.fn<(itemId: string) => void>();
  const selectAllVisiblePreviewItems = overrides?.selectAllVisiblePreviewItems ?? vi.fn<() => void>();
  const deselectAllVisiblePreviewItems = overrides?.deselectAllVisiblePreviewItems ?? vi.fn<() => void>();
  const selectAllImportablePreviewItems = overrides?.selectAllImportablePreviewItems ?? vi.fn<() => void>();

  const result = render(
    <ImportTab
      isProcessing={overrides?.isProcessing ?? false}
      handleImport={handleImport}
      fileInputRef={React.createRef<HTMLInputElement>()}
      importResult={overrides?.importResult ?? null}
      importAnalysis={overrides?.importAnalysis}
      importFilters={overrides?.importFilters}
      updateImportFilters={updateImportFilters}
      resetImportFilters={resetImportFilters}
      importOptions={overrides?.importOptions}
      updateImportOptions={updateImportOptions}
      previewItems={overrides?.previewItems}
      visiblePreviewItems={overrides?.visiblePreviewItems}
      availableProtocols={overrides?.availableProtocols}
      selectedPreviewIds={overrides?.selectedPreviewIds}
      selectedCount={overrides?.selectedCount}
      handleFileSelect={handleFileSelect}
      confirmImport={confirmImport}
      cancelImport={cancelImport}
      togglePreviewSelection={togglePreviewSelection}
      selectAllVisiblePreviewItems={selectAllVisiblePreviewItems}
      deselectAllVisiblePreviewItems={deselectAllVisiblePreviewItems}
      selectAllImportablePreviewItems={selectAllImportablePreviewItems}
      detectedFormat={overrides?.detectedFormat}
    />,
  );

  return {
    ...result,
    handleImport,
    handleFileSelect,
    confirmImport,
    cancelImport,
    updateImportFilters,
    resetImportFilters,
    updateImportOptions,
    togglePreviewSelection,
    selectAllVisiblePreviewItems,
    deselectAllVisiblePreviewItems,
    selectAllImportablePreviewItems,
  };
}

const makeConnection = (overrides: Partial<Connection>): Connection => ({
  id: "import-1",
  name: "Server A",
  protocol: "ssh",
  hostname: "10.0.0.5",
  port: 22,
  username: "root",
  isGroup: false,
  tags: ["prod"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("ImportTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:mock"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("opens the file chooser and forwards file input changes", () => {
    const { handleImport, handleFileSelect } = renderImportTab();

    fireEvent.click(screen.getByRole("button", { name: "Choose File" }));
    expect(handleImport).toHaveBeenCalledTimes(1);

    const input = screen.getByTestId("import-file-input");
    const file = new File(["{}"], "import.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(handleFileSelect).toHaveBeenCalledTimes(1);
    expect(input).toHaveAttribute("accept", ".json,.xml,.csv,.ini,.reg,.rdg,.rtsz,.rtsx,.encrypted");
  });

  it("downloads CSV and JSON templates and reports the download via toast", () => {
    renderImportTab();

    fireEvent.click(screen.getByRole("button", { name: "CSV Template" }));
    fireEvent.click(screen.getByRole("button", { name: "JSON Template" }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(toastSuccess).toHaveBeenCalledWith(
      'Template "sortofremoteng-import-template.csv" downloaded to your Downloads folder',
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      'Template "sortofremoteng-import-template.json" downloaded to your Downloads folder',
    );
  });

  it("renders a disabled processing state while an import is being prepared", () => {
    renderImportTab({ isProcessing: true });

    const button = screen.getByRole("button", { name: "Processing..." });

    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders a successful preview with detected format, errors, and confirm actions", () => {
    const { confirmImport, cancelImport } = renderImportTab({
      detectedFormat: "JSON",
      importResult: {
        success: true,
        imported: 3,
        errors: ["Skipped duplicate connection"],
        connections: [],
      },
    });

    expect(screen.getByTestId("import-preview")).toBeInTheDocument();
    expect(screen.getByText("Import Successful")).toBeInTheDocument();
    expect(screen.getByText("Found 3 connections ready to import.")).toBeInTheDocument();
    expect(screen.getAllByText("JSON").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Skipped duplicate connection/, { selector: "li" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("import-confirm"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirmImport).toHaveBeenCalledTimes(1);
    expect(cancelImport).toHaveBeenCalledTimes(1);
  });

  it("renders import analysis, preview controls, selection, filters, and options", () => {
    const previewItems: ImportPreviewItem[] = [
      {
        id: "connection:import-1:0",
        kind: "connection",
        sourceIndex: 1,
        sourcePath: "Production / Server A",
        name: "Server A",
        protocol: "ssh",
        hostname: "10.0.0.5",
        port: 22,
        username: "root",
        parentName: "Production",
        tags: ["prod", "linux"],
        connection: makeConnection({ id: "import-1" }),
        importable: true,
        selectedByDefault: true,
        conflictStatus: "none",
        issues: [],
      },
      {
        id: "connection:import-2:1",
        kind: "connection",
        sourceIndex: 2,
        sourcePath: "Server B",
        name: "Server B",
        protocol: "rdp",
        hostname: "",
        port: 3389,
        username: "admin",
        tags: [],
        connection: makeConnection({
          id: "import-2",
          name: "Server B",
          protocol: "rdp",
          hostname: "",
          port: 3389,
          username: "admin",
          password: "plain-secret",
          tags: [],
        }),
        importable: true,
        selectedByDefault: true,
        conflictStatus: "sameEndpoint",
        duplicateOf: "existing-1",
        issues: [
          {
            severity: "warning",
            code: "missing_hostname",
            field: "hostname",
            message: "Hostname is empty.",
          },
        ],
      },
    ];

    const importAnalysis: ImportSourceMetadata = {
      filename: "sample.json",
      extension: "json",
      sizeBytes: 2048,
      format: "json",
      formatName: "JSON",
      detectedAt: "2026-05-08T12:00:00.000Z",
      confidence: "high",
      encrypted: false,
      counts: {
        totalItems: 2,
        connections: 2,
        folders: 0,
        conflicts: 1,
        warnings: 1,
        errors: 0,
        vpnConnections: 0,
        tunnelChains: 0,
      },
      json: {
        shape: "connections-object",
        topLevelKeys: ["connections"],
      },
    };

    const {
      updateImportFilters,
      resetImportFilters,
      updateImportOptions,
      togglePreviewSelection,
      selectAllVisiblePreviewItems,
      deselectAllVisiblePreviewItems,
      selectAllImportablePreviewItems,
    } = renderImportTab({
      detectedFormat: "JSON",
      importResult: {
        success: true,
        imported: 2,
        errors: [],
        connections: [],
      },
      importAnalysis,
      previewItems,
      visiblePreviewItems: previewItems,
      availableProtocols: ["rdp", "ssh"],
      selectedPreviewIds: new Set(["connection:import-1:0"]),
      selectedCount: 1,
    });

    expect(screen.getByText("sample.json")).toBeInTheDocument();
    expect(screen.getAllByText("Connections").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Conflicts").length).toBeGreaterThan(0);
    expect(screen.getByText("1 selected | 2 visible after filters | 2 total preview rows")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Server A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Server B" })).not.toBeChecked();
    expect(screen.getByText("missing_hostname")).toBeInTheDocument();
    expect(screen.getByText("Full parsed record")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Server B" }));
    expect(screen.getByText(/"id": "import-2"/)).toBeInTheDocument();
    expect(screen.getByText(/"password": "\[hidden\]"/)).toBeInTheDocument();
    expect(screen.queryByText("plain-secret")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search name, host, folder, tags, issues"), {
      target: { value: "server" },
    });
    fireEvent.change(screen.getByLabelText("Protocol filter"), {
      target: { value: "rdp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    fireEvent.click(screen.getByLabelText("Include credentials"));
    fireEvent.change(screen.getByLabelText("Conflict policy"), {
      target: { value: "rename" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Server B" }));
    fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear visible" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all importable" }));

    expect(updateImportFilters).toHaveBeenCalledWith({ search: "server" });
    expect(updateImportFilters).toHaveBeenCalledWith({ protocol: "rdp" });
    expect(resetImportFilters).toHaveBeenCalledTimes(1);
    expect(updateImportOptions).toHaveBeenCalledWith({ includeCredentials: false });
    expect(updateImportOptions).toHaveBeenCalledWith({ conflictPolicy: "rename" });
    expect(togglePreviewSelection).toHaveBeenCalledWith("connection:import-2:1");
    expect(selectAllVisiblePreviewItems).toHaveBeenCalledTimes(1);
    expect(deselectAllVisiblePreviewItems).toHaveBeenCalledTimes(1);
    expect(selectAllImportablePreviewItems).toHaveBeenCalledTimes(1);
  });

  it("renders a failed preview and routes retry through cancelImport", () => {
    const { cancelImport } = renderImportTab({
      importResult: {
        success: false,
        imported: 0,
        errors: ["Unsupported file format"],
        connections: [],
      },
    });

    expect(screen.getByText("Import Failed")).toBeInTheDocument();
    expect(
      screen.getByText(/Unsupported file format/, { selector: "li" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    expect(cancelImport).toHaveBeenCalledTimes(1);
  });
});
