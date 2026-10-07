/** Reserved native database material must never enter a renderer-owned payload. */
export class NativePrivateDataError extends Error {
  constructor() {
    super(
      "Native-private browser session data is not a public database payload. No data was saved; use the native protected transfer boundary.",
    );
    this.name = "NativePrivateDataError";
  }
}

/** Inspect the descriptor, not its value: even an accessor or empty private
 * field is a contract violation. Never include private input in diagnostics. */
export function assertPublicDatabaseData(value: unknown): void {
  if (
    value !== null &&
    typeof value === "object" &&
    ["_nativeBrowserSessions", "nativeBrowserSessions"].some(
      (field) => Object.getOwnPropertyDescriptor(value, field) !== undefined,
    )
  )
    throw new NativePrivateDataError();
}
