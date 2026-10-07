export type VncDiagnosticCode =
  | "ready"
  | "refused"
  | "timeout"
  | "dns"
  | "unreachable"
  | "authentication"
  | "security"
  | "protocol"
  | "closed"
  | "routeBlocked"
  | "invalidTarget"
  | "busy"
  | "unavailable"
  | "unknown";

export interface VncDiagnosticRequest {
  host: string;
  port: number;
  route: "direct" | "blocked";
}

export interface VncDiagnosticStep {
  stage: "dns" | "tcp" | "rfb";
  status: "passed" | "failed" | "skipped";
  code: VncDiagnosticCode;
  durationMs: number;
}

export interface VncDiagnosticReport {
  code: VncDiagnosticCode;
  steps: VncDiagnosticStep[];
  resolvedAddresses: string[];
  protocolVersion: string | null;
  durationMs: number;
}
