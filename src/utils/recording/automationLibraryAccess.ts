import type { AutomationLibraryDiagnostic } from "../../types/recording/automationLibrary";

export class AutomationLibraryAccessError extends Error {
  constructor(readonly diagnostic: AutomationLibraryDiagnostic) {
    super(diagnostic.message);
    this.name = "AutomationLibraryAccessError";
  }
}

/** Never exposes native paths, JSON fragments, or script contents. */
export function automationLibraryDiagnostic(
  error: unknown,
): AutomationLibraryDiagnostic {
  if (error instanceof AutomationLibraryAccessError) return error.diagnostic;
  const reason =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (
    /unknown command|command.*not found|not registered|state.*not managed/i.test(
      reason,
    )
  )
    return {
      code: "backend-unavailable",
      message:
        "The desktop library backend is unavailable. Restart the updated desktop app, then retry. No fallback library was created.",
      retryable: true,
    };
  if (/conflicting.*variant|recovery|mixed.*variant/i.test(reason))
    return {
      code: "recovery-required",
      message:
        "The library has conflicting storage variants or recovery data. Review storage recovery before retrying; neither copy was reset.",
      retryable: true,
    };
  if (/locked|unlock|key.*unavailable|master.*key/i.test(reason))
    return {
      code: "locked",
      message:
        "The app-wide library's encryption is locked or its key is unavailable. Unlock app encryption, then retry. Opening a connection database does not unlock this separate library.",
      retryable: true,
    };
  if (
    /corrupt|invalid|malformed|deserialize|decrypt|unsupported|oversiz|limit|credential/i.test(
      reason,
    )
  )
    return {
      code: "invalid-library",
      message:
        "The library or proposed item could not be validated. Check its format, size, credential-free contents, and storage integrity. Existing data was not reset.",
      retryable: true,
    };
  if (/changed|concurrent|conflict/i.test(reason))
    return {
      code: "conflict",
      message:
        "Library data or access changed. Reload and review before retrying; a pending write may already have completed.",
      retryable: true,
    };
  return {
    code: "storage-unavailable",
    message:
      "The app-wide library could not be read or written. Check desktop storage availability and retry. Existing data was not reset.",
    retryable: true,
  };
}
