import {
  FunctionService,
  IFunctionService,
  type BaseFunction,
} from "@univerjs/engine-formula";
import type { Univer } from "@univerjs/core";
import { validateDocumentFormula } from "./validation";
/** Filters every registration, including lifecycle-delayed built-ins, before execution. */
export class LocalSpreadsheetFunctionService extends FunctionService {
  override registerExecutors(...functions: BaseFunction[]) {
    super.registerExecutors(
      ...functions.filter((fn) => {
        try {
          validateDocumentFormula(`=${fn.name}(1)`);
          return true;
        } catch {
          return false;
        }
      }),
    );
  }
}
/** Must run after plugin onStarting registers dependencies and before createUnit/onReady. */
export function installLocalSpreadsheetFunctions(engine: Univer): void {
  engine
    .__getInjector()
    .replace([IFunctionService, { useClass: LocalSpreadsheetFunctionService }]);
  if (
    !(
      engine.__getInjector().get(IFunctionService) instanceof
      LocalSpreadsheetFunctionService
    )
  )
    throw Error(
      "The offline spreadsheet formula policy could not be installed.",
    );
}
