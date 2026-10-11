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
import DocumentBlockEditor from "../../src/components/documents/DocumentBlockEditor";
import { useOriginBrowserOverlays } from "../../src/hooks/protocol/useOriginBrowserOverlays";
import type {
  DocumentWorkbook,
  DocumentReference,
  DocumentBlock,
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
vi.mock("../../src/components/documents/RichTextEditor", () => ({
  default: () => <textarea aria-label="Writing area" />,
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
  it("registers the expanded panel with the existing native browser occlusion observer", async () => {
    function Harness() {
      const overlay = useOriginBrowserOverlays(true);
      return (
        <>
          <SpreadsheetEditor
            workbook={workbook}
            documentKey="one"
            onChange={vi.fn()}
          />
          <output data-testid="occlusions">
            {JSON.stringify(overlay.rectangles)}
          </output>
        </>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(mocked.create).toHaveBeenCalledOnce());
    const panel = screen.getByRole("region", { name: "Document spreadsheet" });
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 700,
      bottom: 450,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    });
    expect(panel).not.toHaveAttribute("data-native-browser-occlusion");
    fireEvent.click(screen.getByRole("button", { name: "Expand spreadsheet" }));
    expect(panel).toHaveAttribute("data-native-browser-occlusion");
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("occlusions").textContent!)).toEqual(
        [{ x: 98, y: 48, width: 604, height: 404 }],
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse spreadsheet" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("occlusions")).toHaveTextContent("[]"),
    );
    expect(mocked.create).toHaveBeenCalledOnce();
  });
  it.each(["Write", "Blocks"])(
    "keeps a single spreadsheet draft through expansion in %s mode",
    async (mode) => {
      const onDraft = vi.fn();
      function Harness() {
        const [blocks, setBlocks] = React.useState<DocumentBlock[]>([
          { id: "sheet", type: "spreadsheet", workbook },
        ]);
        return (
          <DocumentBlockEditor
            blocks={blocks}
            onChange={(next) => {
              setBlocks(next);
              onDraft(next);
            }}
            attachments={[]}
            documentKey="document"
            renderSpreadsheet={(block, onChange, readOnly) => (
              <SpreadsheetEditor
                workbook={block.workbook}
                onChange={onChange}
                readOnly={readOnly}
                documentKey={`document:${block.id}`}
              />
            )}
          />
        );
      }
      render(<Harness />);
      await waitFor(() => expect(mocked.create).toHaveBeenCalledOnce());
      fireEvent.click(screen.getByRole("button", { name: mode }));
      const surface = screen.getByTestId("document-spreadsheet-surface");
      const changed = structuredClone(workbook);
      changed.sheets[0].cells.A1.value = "Draft from the engine";
      act(() => mocked.options!.onChange(changed, []));
      fireEvent.click(
        screen.getByRole("button", { name: "Expand spreadsheet" }),
      );
      const expandedDraft = structuredClone(changed);
      expandedDraft.sheets[0].cells.A1.value = "Edited while expanded";
      act(() => mocked.options!.onChange(expandedDraft, []));
      fireEvent.click(
        screen.getByRole("button", { name: "Collapse spreadsheet" }),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: mode === "Write" ? "Blocks" : "Write",
        }),
      );
      expect(screen.getByTestId("document-spreadsheet-surface")).toBe(surface);
      expect(mocked.create).toHaveBeenCalledOnce();
      expect(mocked.dispose).not.toHaveBeenCalled();
      expect(onDraft).toHaveBeenLastCalledWith([
        { id: "sheet", type: "spreadsheet", workbook: expandedDraft },
      ]);
    },
  );
  it("expands and resizes the same engine while retaining its draft, note and pending review", async () => {
    const onChange = vi.fn();
    const validity = vi.fn();
    render(
      <SpreadsheetEditor
        workbook={workbook}
        documentKey="one"
        onChange={onChange}
        onValidityChange={validity}
      />,
    );
    await waitFor(() => expect(mocked.create).toHaveBeenCalledOnce());
    const surface = screen.getByTestId("document-spreadsheet-surface");
    const changed = structuredClone(workbook);
    changed.sheets[0].cells.A1.value = "Unsaved cell";
    act(() => mocked.options!.onChange(changed, []));
    expect(onChange).toHaveBeenLastCalledWith(changed);
    fireEvent.click(screen.getByRole("button", { name: "Cell note" }));
    const note = screen.getByRole("textbox", { name: "Selected cell note" });
    fireEvent.change(note, { target: { value: "Unsaved note" } });
    act(() => mocked.options!.onChange(changed, ["Unsupported formatting"]));
    const handle = screen.getByRole("separator", {
      name: "Spreadsheet height",
    });
    fireEvent.keyDown(handle, { key: "End" });
    expect(surface).toHaveStyle({ height: "1000px" });
    const toggle = screen.getByRole("button", { name: "Expand spreadsheet" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("document-spreadsheet-surface")).toBe(surface);
    expect(note).toHaveValue("Unsaved note");
    fireEvent.change(note, { target: { value: "Note edited while expanded" } });
    expect(
      screen.getByRole("region", { name: "Spreadsheet compatibility review" }),
    ).toBeVisible();
    expect(validity).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByRole("separator", { name: "Spreadsheet height" }),
    ).toBeNull();
    fireEvent.keyDown(note, { key: "Escape" });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(surface).toHaveStyle({ height: "1000px" });
    expect(note).toHaveValue("Note edited while expanded");
    expect(mocked.create).toHaveBeenCalledOnce();
    expect(mocked.dispose).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByTestId("document-spreadsheet-surface")).toBe(surface);
    expect(mocked.create).toHaveBeenCalledOnce();
  });
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
