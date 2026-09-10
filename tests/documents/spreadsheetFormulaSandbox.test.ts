import { describe, expect, it } from "vitest";
import { Univer, UniverInstanceType } from "@univerjs/core";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import {
  IFunctionService,
  UniverFormulaEnginePlugin,
} from "@univerjs/engine-formula";
import {
  LocalSpreadsheetFunctionService,
  installLocalSpreadsheetFunctions,
} from "../../src/utils/documents/spreadsheetFormulaSandbox";
import { toUniverWorkbook } from "../../src/utils/documents/spreadsheetUniverAdapter";
describe("actual Univer formula service sandbox", () => {
  it("keeps the local registry implementation across startup and removes network/indirect/custom functions", () => {
    const engine = new Univer({
      override: [
        [IFunctionService, { useClass: LocalSpreadsheetFunctionService }],
      ],
      logCommandExecution: false,
    });
    try {
      engine.registerPlugin(UniverSheetsPlugin);
      engine.registerPlugin(UniverFormulaEnginePlugin);
      installLocalSpreadsheetFunctions(engine);
      engine.createUnit(
        UniverInstanceType.UNIVER_SHEET,
        toUniverWorkbook({
          version: 1,
          styles: {},
          validations: {},
          sheets: [
            {
              id: "sheet",
              name: "Sheet",
              rows: 10,
              columns: 10,
              cells: {
                A1: { value: 2 },
                A2: { value: null, formula: "=SUM(A1,A1)" },
              },
              merges: [],
              rowMetadata: {},
              columnMetadata: {},
            },
          ],
        }),
      );
      const functions = engine.__getInjector().get(IFunctionService);
      expect(functions).toBeInstanceOf(LocalSpreadsheetFunctionService);
      expect(functions.hasExecutor("SUM")).toBe(true);
      expect(functions.hasExecutor("WEBSERVICE")).toBe(false);
      expect(functions.hasExecutor("HYPERLINK")).toBe(false);
      expect(functions.hasExecutor("INDIRECT")).toBe(false);
    } finally {
      engine.dispose();
    }
  });
});
