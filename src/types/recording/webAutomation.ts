/** Website interactions are not terminal commands or HAR recordings. */
export type WebInteractionStep =
  | { kind: "click"; selector: string }
  | { kind: "check"; selector: string; checked: boolean }
  | { kind: "fill"; selector: string };

interface WebAutomationMetadata {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserScript extends WebAutomationMetadata {
  kind: "script";
  /** Omitted in legacy libraries; omission means JavaScript. */
  language?: "javascript" | "typescript";
  code: string;
}

export interface WebInteractionMacro extends WebAutomationMetadata {
  kind: "macro";
  /** No input values, passwords, text snapshots, URLs, or request bodies. */
  steps: WebInteractionStep[];
}

export type WebAutomationItem = BrowserScript | WebInteractionMacro;

export interface WebAutomationLibrary {
  version: 1;
  scripts: BrowserScript[];
  macros: WebInteractionMacro[];
  /** Informational sidecar; executable payloads remain strictly unchanged. */
  provenance?: Record<
    string,
    import("./automationLibrary").AutomationProvenance
  >;
}

export interface WebAutomationDocument {
  generation: number;
  sessionId: string;
  token: string;
  sequence: number;
  navigationToken: string | null;
  url: string;
}
