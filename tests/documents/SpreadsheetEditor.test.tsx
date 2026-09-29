import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SpreadsheetEditor from "../../src/components/documents/SpreadsheetEditor";
import type {
  DocumentWorkbook,
  DocumentReference,
} from "../../src/types/documents/document";
const mocked = vi.hoisted(() => ({
  create: vi.fn(),
  dispose: vi.fn(),
  setMetadata: vi.fn(),
  focus: vi.fn(),
  options: null as null | {
    onChange: (value: DocumentWorkbook, warnings: string[]) => void;
    onError: (message: string) => void;
  },
  importFile: vi.fn(),
}));
vi.mock("../../src/utils/documents/spreadsheetRuntime", () => ({
  createSpreadsheetRuntime: mocked.create,
}));
vi.mock("../../src/utils/documents/spreadsheetFiles", () => ({
  importSpreadsheetFile: mocked.importFile,
  exportSpreadsheetFile: vi.fn(),
}));
const workbook: DocumentWorkbook = {
  version: 1,
  styles: {},
  validations: {},
  sheets: [
    {
      id: "sheet",
      name: "Sheet",
      rows: 20,
      columns: 20,
      cells: { A1: { value: "safe" } },
      merges: [],
      rowMetadata: {},
      columnMetadata: {},
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocked.create.mockImplementation((_container, _workbook, options) => {
    mocked.options = options;
    return {
      dispose: mocked.dispose,
      snapshot: () => workbook,
      review: () => ({ workbook, warnings: [] }),
      selection: () => ({ sheetId: "sheet", address: "A1" }),
      setCellMetadata: mocked.setMetadata,
      focus: mocked.focus,
    };
  });
  mocked.importFile.mockResolvedValue({
    workbook,
    warnings: ["Unsupported formatting"],
  });
});
afterEach(cleanup);
describe("document spreadsheet lifecycle", () => {
  it("groups cell and file actions and rechecks a missing link without replacing the engine", async () => {
    const onChange = vi.fn();
    render(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="one"
        onChange={onChange}
        onImport={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    const cells = within(screen.getByRole("group", { name: "Cell actions" }));
    const files = within(
      screen.getByRole("group", { name: "Spreadsheet files" }),
    );
    await waitFor(() =>
      expect(
        cells.getByRole("button", { name: "Open cell link" }),
      ).not.toBeDisabled(),
    );
    expect(cells.getAllByRole("button")).toHaveLength(3);
    expect(
      files.getByRole("button", { name: "Import XLSX / CSV" }),
    ).toBeEnabled();
    expect(files.getByRole("button", { name: "Export XLSX" })).toBeEnabled();
    fireEvent.click(cells.getByRole("button", { name: "Open cell link" }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The selected cell has no document link.");
    expect(files.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    fireEvent.click(
      within(alert).getByRole("button", { name: "Recheck current sheet" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(files.getByRole("button", { name: "Export CSV" })).toBeEnabled();
    expect(onChange).toHaveBeenCalledWith(workbook);
    expect(mocked.create).toHaveBeenCalledOnce();
    expect(mocked.dispose).not.toHaveBeenCalled();
  });
  it("preserves the engine and an unsaved note across app palette changes", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="one"
        onChange={onChange}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Cell note" }),
      ).not.toBeDisabled(),
    );
    const surface = screen.getByTestId("document-spreadsheet-surface");
    fireEvent.click(screen.getByRole("button", { name: "Cell note" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Selected cell note" }),
      {
        target: { value: "Unsaved note" },
      },
    );
    const rootStyle = document.documentElement.getAttribute("style");
    const bodyClass = document.body.getAttribute("class");
    try {
      for (const scheme of ["light", "dark"]) {
        await act(async () => {
          document.documentElement.style.setProperty(
            "--native-color-scheme",
            scheme,
          );
          document.documentElement.style.setProperty(
            "--color-surface",
            scheme === "light" ? "#f3f4f6" : "#1f2937",
          );
          document.body.classList.toggle("dark", scheme === "dark");
        });
        rerender(
          <SpreadsheetEditor
            workbook={workbook}
            documentKey="one"
            onChange={onChange}
          />,
        );
        expect(screen.getByTestId("document-spreadsheet-surface")).toBe(
          surface,
        );
        expect(
          screen.getByRole("textbox", { name: "Selected cell note" }),
        ).toHaveValue("Unsaved note");
        expect(mocked.create).toHaveBeenCalledOnce();
        expect(mocked.dispose).not.toHaveBeenCalled();
      }
      fireEvent.click(screen.getByRole("button", { name: "Apply cell note" }));
      expect(mocked.setMetadata).toHaveBeenCalledWith({
        reference: undefined,
        note: "Unsaved note",
      });
      act(() => mocked.options!.onChange(workbook, []));
      expect(onChange).toHaveBeenCalledWith(workbook);
    } finally {
      if (rootStyle === null) document.documentElement.removeAttribute("style");
      else document.documentElement.setAttribute("style", rootStyle);
      if (bodyClass === null) document.body.removeAttribute("class");
      else document.body.setAttribute("class", bodyClass);
    }
  });
  it("publishes valid edits and holds unsupported edits behind explicit review", async () => {
    const onChange = vi.fn(),
      validity = vi.fn();
    render(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="one"
        onChange={onChange}
        onValidityChange={validity}
      />,
    );
    await waitFor(() => expect(mocked.create).toHaveBeenCalledOnce());
    act(() => mocked.options!.onChange(workbook, ["Unsupported formatting"]));
    expect(onChange).not.toHaveBeenCalled();
    expect(validity).toHaveBeenLastCalledWith(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Use reviewed workbook" }),
    );
    expect(onChange).toHaveBeenCalledWith(workbook);
    expect(validity).toHaveBeenLastCalledWith(true);
  });
  it("disposes undo history and ignores old engine edits when owner/document changes", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="owner-a"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(mocked.create).toHaveBeenCalledOnce());
    const old = mocked.options!;
    rerender(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="owner-b"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(mocked.create).toHaveBeenCalledTimes(2));
    act(() => old.onChange(workbook, []));
    expect(mocked.dispose).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("discards a delayed reference picker after access is revoked", async () => {
    let resolve!: (ref: DocumentReference) => void;
    const choose = vi.fn(
      () =>
        new Promise<DocumentReference>((done) => {
          resolve = done;
        }),
    );
    const { rerender } = render(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="one"
        onChange={vi.fn()}
        onChooseReference={choose}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Link selected cell" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Link selected cell" }));
    rerender(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="locked"
        readOnly
        onChange={vi.fn()}
        onChooseReference={choose}
      />,
    );
    await act(async () =>
      resolve({ databaseId: "a", kind: "document", id: "doc" }),
    );
    expect(mocked.setMetadata).not.toHaveBeenCalled();
  });
  it("does not import automatically and requires replacement review", async () => {
    const choose = vi.fn(async () => ({
        name: "demo.xlsx",
        bytes: new Uint8Array([1]),
      })),
      onChange = vi.fn();
    render(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="one"
        onChange={onChange}
        onImport={choose}
      />,
    );
    await waitFor(() => expect(mocked.create).toHaveBeenCalledOnce());
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import XLSX / CSV" }));
    await screen.findByRole("region", {
      name: "Spreadsheet compatibility review",
    });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(onChange).not.toHaveBeenCalled();
  });
  it("selects a valid linked cell but warns without navigating for stale bounds", async () => {
    const ref: Extract<DocumentReference, { kind: "cell" }> = {
      databaseId: "a",
      kind: "cell",
      id: "doc",
      blockId: "block",
      sheetId: "sheet",
      address: "B2",
    };
    const { rerender } = render(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="one"
        onChange={vi.fn()}
        focusReference={ref}
      />,
    );
    await waitFor(() =>
      expect(mocked.focus).toHaveBeenCalledWith("sheet", "B2"),
    );
    rerender(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="one"
        onChange={vi.fn()}
        focusReference={{ ...ref, address: "Z999" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
    expect(mocked.focus).toHaveBeenCalledOnce();
  });
});
