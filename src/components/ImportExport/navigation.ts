import { createContext, useContext } from "react";

/** Navigation carries identifiers and UI choices only, never database contents or passwords. */
export type ImportExportNavigation =
  | { tab: "import"; format: "json" }
  | {
      tab: "export";
      format: "json";
      databaseIds: string[];
      encrypted?: boolean;
    };

export const ImportExportNavigationContext = createContext<
  ((request: ImportExportNavigation) => void) | undefined
>(undefined);

export const useImportExportNavigation = () =>
  useContext(ImportExportNavigationContext);
