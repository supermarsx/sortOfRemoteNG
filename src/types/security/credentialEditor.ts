import type { DatabaseCredentialScope } from "./databaseCredentialVault";

/** Safe app-tab navigation only: never attach credentials or a Connection. */
export type CredentialEditorRequest = { scope: DatabaseCredentialScope } & (
  | { mode: "create" }
  | { mode: "edit"; credentialId: string }
  | { mode: "migrate"; connectionId: string }
);
