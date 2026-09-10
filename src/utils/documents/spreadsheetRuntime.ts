// Lazy module: no editor/engine dependency is reachable from cold document metadata.
import { Univer, LocaleType, LogLevel, CommandType } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { defaultTheme } from "@univerjs/themes";
import {
  UniverSheetsCorePreset,
  UniverNetworkPlugin,
  IHTTPImplementation,
} from "@univerjs/preset-sheets-core";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import coreLocale from "@univerjs/preset-sheets-core/locales/en-US";
import validationLocale from "@univerjs/preset-sheets-data-validation/locales/en-US";
import filterLocale from "@univerjs/preset-sheets-filter/locales/en-US";
import sortLocale from "@univerjs/preset-sheets-sort/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import type {
  DocumentWorkbook,
  DocumentReference,
} from "../../types/documents/document";
import { installLocalSpreadsheetFunctions } from "./spreadsheetFormulaSandbox";
import {
  assertSafeSpreadsheetCommand,
  spreadsheetAddress,
} from "./spreadsheetModel";
import {
  toUniverWorkbook,
  fromUniverWorkbook,
} from "./spreadsheetUniverAdapter";

export interface SpreadsheetRuntime {
  snapshot(): DocumentWorkbook;
  review(): ReturnType<typeof fromUniverWorkbook>;
  focus(sheetId: string, address: string): void;
  selection(): {
    sheetId: string;
    address: string;
    reference?: DocumentReference;
    note?: string;
  } | null;
  setCellMetadata(metadata: {
    reference?: DocumentReference;
    note?: string;
  }): void;
  dispose(): void;
}
export function createSpreadsheetRuntime(
  container: HTMLElement,
  workbook: DocumentWorkbook,
  options: {
    readOnly: boolean;
    onChange: (value: DocumentWorkbook, warnings: string[]) => void;
    onError: (message: string) => void;
  },
): SpreadsheetRuntime {
  const offline = {
    send(): never {
      throw Error(
        "This document spreadsheet is offline; network requests are disabled.",
      );
    },
  };
  const univer = new Univer({
    theme: defaultTheme,
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: {
        ...coreLocale,
        ...validationLocale,
        ...filterLocale,
        ...sortLocale,
      },
    },
    logLevel: LogLevel.SILENT,
    logCommandExecution: false,
  });
  const presets = [
    UniverSheetsCorePreset({
      container,
      header: true,
      toolbar: true,
      formulaBar: true,
      disableAutoFocus: true,
      customFontFamily: ["sans-serif", "serif", "monospace"].map((value) => ({
        value,
        label: value,
      })),
    }),
    UniverSheetsDataValidationPreset(),
    UniverSheetsFilterPreset(),
    UniverSheetsSortPreset(),
  ];
  for (const preset of presets)
    for (const entry of preset.plugins) {
      const plugin = Array.isArray(entry) ? entry[0] : entry;
      if (plugin === UniverNetworkPlugin)
        univer.registerPlugin(plugin, {
          override: [[IHTTPImplementation, { useValue: offline }]],
        });
      else if (Array.isArray(entry)) univer.registerPlugin(entry[0], entry[1]);
      else univer.registerPlugin(entry);
    }
  installLocalSpreadsheetFunctions(univer);
  const api = FUniver.newAPI(univer);
  let disposed = false,
    initialized = false,
    signature = JSON.stringify(workbook);
  const before = api.addEvent(api.Event.BeforeCommandExecute, (event) => {
    if (disposed) {
      event.cancel = true;
      return;
    }
    // Engine-generated calculation mutations remain necessary for read-only previews.
    if (initialized && options.readOnly && event.type === CommandType.COMMAND) {
      event.cancel = true;
      return;
    }
    try {
      if (
        /register-function|defined-name|drawing|image|hyperlink/i.test(event.id)
      )
        throw Error(
          "External content and custom spreadsheet functions are disabled.",
        );
      if (event.type === CommandType.OPERATION) return;
      assertSafeSpreadsheetCommand(event.params);
    } catch {
      event.cancel = true;
      options.onError(
        "That spreadsheet operation is unsupported or contains a blocked formula. No external content was loaded.",
      );
    }
  });
  const book = api.createWorkbook(toUniverWorkbook(workbook));
  book.setEditable(!options.readOnly);
  initialized = true;
  const executed = api.addEvent(api.Event.CommandExecuted, (event) => {
    if (disposed || options.readOnly || event.type !== CommandType.MUTATION)
      return;
    try {
      const result = fromUniverWorkbook(book.save());
      const next = JSON.stringify(result.workbook);
      if (next !== signature) {
        signature = next;
        options.onChange(result.workbook, result.warnings);
      }
    } catch {
      options.onError(
        "This change cannot be saved in the protected document format. Undo the unsupported operation before saving.",
      );
    }
  });
  return {
    review: () => fromUniverWorkbook(book.save()),
    snapshot: () => fromUniverWorkbook(book.save()).workbook,
    focus(sheetId, address) {
      const sheet = book.getSheetBySheetId(sheetId);
      if (!sheet) throw Error("The linked sheet is unavailable.");
      book.setActiveSheet(sheet);
      sheet.getRange(address).activate();
    },
    selection() {
      const range = book.getActiveRange();
      if (!range) return null;
      const area = range.getRange(),
        metadata = range.getCustomMetaData();
      return {
        sheetId: range.getSheetId(),
        address: spreadsheetAddress(area.startRow, area.startColumn),
        reference: metadata?.documentReference,
        note: metadata?.documentNote,
      };
    },
    setCellMetadata(metadata) {
      if (disposed || options.readOnly)
        throw Error("Spreadsheet is read-only.");
      const range = book.getActiveRange();
      if (!range) throw Error("Select a cell first.");
      const area = range.getRange();
      if (area.startRow !== area.endRow || area.startColumn !== area.endColumn)
        throw Error("Select exactly one cell for a link or note.");
      range.setCustomMetaData({
        ...(metadata.reference && { documentReference: metadata.reference }),
        ...(metadata.note !== undefined && { documentNote: metadata.note }),
      });
    },
    dispose() {
      disposed = true;
      before.dispose();
      executed.dispose();
      // This captured instance owns a nested React root. Fence immediately;
      // unmount after the parent's commit without ever consulting a newer holder.
      queueMicrotask(() => univer.dispose());
    },
  };
}
