import type { ManagedScript } from "../../components/recording/scriptManager/shared";
import type { PersistedManagedScripts } from "../../utils/recording/managedScriptPersistence";
import type { TerminalMacro } from "./macroTypes";
import type {
  BrowserScript,
  WebInteractionMacro,
  WebAutomationLibrary,
} from "./webAutomation";

/** Missing scope on a legacy favorite means app, never the active database. */
export type AutomationScope =
  { kind: "app" } | { kind: "database"; databaseId: string };
export type AutomationFamily =
  "terminal-script" | "terminal-macro" | "website-script" | "website-macro";
export interface AutomationPayloads {
  "terminal-script": ManagedScript;
  "terminal-macro": TerminalMacro;
  "website-script": BrowserScript;
  "website-macro": WebInteractionMacro;
}
/** Informational provenance, not an execution grant or proof of publisher identity. */
export interface AutomationProvenance {
  sourceId?: string;
  sourceUrl?: string;
  sourceSha256?: string;
  publisher?: string;
  license?: string;
  description?: string;
  platforms?: string[];
  tags?: string[];
  importedAt?: string;
}
export type AutomationEntry<F extends AutomationFamily = AutomationFamily> = {
  [K in F]: {
    family: K;
    payload: AutomationPayloads[K];
    provenance?: AutomationProvenance;
  };
}[F];
export interface AutomationLibrarySnapshot<
  F extends AutomationFamily = AutomationFamily,
> {
  scope: AutomationScope;
  family: F;
  /** Opaque, bounded-lifetime review receipt; callers cannot manufacture one. */
  receipt: string;
  entries: AutomationEntry<F>[];
}
export type AutomationLibraryChange<
  F extends AutomationFamily = AutomationFamily,
> =
  | {
      operation: "put";
      entry: AutomationEntry<F>;
      expected?: AutomationEntry<F>;
    }
  | { operation: "delete"; expected: AutomationEntry<F> };
export interface AutomationLibraryApi {
  read<F extends AutomationFamily>(
    scope: AutomationScope,
    family: F,
  ): Promise<AutomationLibrarySnapshot<F>>;
  apply<F extends AutomationFamily>(
    snapshot: AutomationLibrarySnapshot<F>,
    changes: readonly AutomationLibraryChange<F>[],
  ): Promise<AutomationLibrarySnapshot<F>>;
}
export interface DatabaseAutomationLibrary {
  version: 1;
  revision: number;
  terminalScripts: PersistedManagedScripts;
  terminalMacros: TerminalMacro[];
  website: WebAutomationLibrary;
  /** Keys are `${family}:${id}`. Strict website payloads remain unchanged. */
  provenance: Record<string, AutomationProvenance>;
}
export interface DatabaseAutomationScope {
  databaseId: string;
  generation: number;
}
/** The provider owns durable writes; callers must never create a DB side store. */
export interface DatabaseAutomationApi {
  scope: DatabaseAutomationScope | null;
  /** Notification only; not an access lease or persisted library revision. */
  changeRevision?: number;
  read(
    expectedScope: DatabaseAutomationScope,
  ): Promise<DatabaseAutomationLibrary>;
  /** Refresh website previews without advancing the database writer baseline.
   * Execution must compare the selected payload with a new read. */
  readWebsite?(
    expectedScope: DatabaseAutomationScope,
  ): Promise<DatabaseAutomationLibrary>;
  /** Read current SSH actions without flushing drafts or advancing writer
   * baselines. Refuse changes to the saved connection's action configuration.
   * Execution must revalidate the reviewed payload with another read. */
  readSsh?(
    expectedScope: DatabaseAutomationScope,
    connectionId: string,
  ): Promise<DatabaseAutomationLibrary>;
  compareAndSwap(
    expectedScope: DatabaseAutomationScope,
    expected: DatabaseAutomationLibrary,
    replacement: DatabaseAutomationLibrary,
  ): Promise<void>;
}
export type AutomationAccessFailure =
  | "initializing"
  | "desktop-required"
  | "backend-unavailable"
  | "locked"
  | "recovery-required"
  | "database-unavailable"
  | "access-changed"
  | "storage-unavailable"
  | "invalid-library"
  | "conflict";
export interface AutomationLibraryDiagnostic {
  code: AutomationAccessFailure;
  message: string;
  retryable: boolean;
}
