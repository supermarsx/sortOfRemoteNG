import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImportTab from "../../src/components/ImportExport/ImportTab";
import type { ImportResult } from "../../src/components/ImportExport/types";

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
  handleImport?: () => void;
  handleFileSelect?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  confirmImport?: () => void | Promise<void>;
  cancelImport?: () => void;
  detectedFormat?: string;
}) {
  const handleImport = overrides?.handleImport ?? vi.fn<() => void>();
  const handleFileSelect = overrides?.handleFileSelect ?? vi.fn<(event: React.ChangeEvent<HTMLInputElement>) => void>();
  const confirmImport = overrides?.confirmImport ?? vi.fn<() => void | Promise<void>>();
  const cancelImport = overrides?.cancelImport ?? vi.fn<() => void>();

  const result = render(
    <ImportTab
      isProcessing={overrides?.isProcessing ?? false}
      handleImport={handleImport}
      fileInputRef={React.createRef<HTMLInputElement>()}
      importResult={overrides?.importResult ?? null}
      handleFileSelect={handleFileSelect}
      confirmImport={confirmImport}
      cancelImport={cancelImport}
      detectedFormat={overrides?.detectedFormat}
    />,
  );

  return {
    ...result,
    handleImport,
    handleFileSelect,
    confirmImport,
    cancelImport,
  };
}

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
    expect(input).toHaveAttribute("accept", ".json,.xml,.csv,.ini,.reg,.encrypted");
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
    expect(screen.getByText("JSON")).toBeInTheDocument();
    expect(
      screen.getByText(/Skipped duplicate connection/, { selector: "li" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("import-confirm"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirmImport).toHaveBeenCalledTimes(1);
    expect(cancelImport).toHaveBeenCalledTimes(1);
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