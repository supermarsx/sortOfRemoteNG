export type RuntimeNetworkPathErrorCode =
  "invalid-path" | "snapshot-unavailable" | "unsupported-layer";

/** Safe source metadata and transport labels only; never credentials/config values. */
export class RuntimeNetworkPathError extends Error {
  constructor(
    readonly code: RuntimeNetworkPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeNetworkPathError";
  }
}
