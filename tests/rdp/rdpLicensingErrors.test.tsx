import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import RDPErrorScreen from "../../src/components/rdp/RDPErrorScreen";
import {
  buildRdpDiagnostics,
  classifyRdpError,
  RDP_ERROR_CATEGORY_LABELS,
} from "../../src/utils/rdp/rdpErrorClassifier";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const reported =
  "connect_finalize failed: [LicensingErrorMessage] custom error, caused by: the server returned unexpected error: LicensingErrorMessage { license_header: LicenseHeader { security_header: BasicSecurityHeader { flags: BasicSecurityHeaderFlags(LICENSE_PKT) }, preamble_message_type: ErrorAlert, preamble_flags: PreambleFlags(0x0), preamble_version: V3, preamble_message_size: 16 }, error_code: InvalidClient, state_transition: TotalAbort, error_info: [] } [phase=BasicSettingsExchange, auth_elapsed=245ms,tcp=1ms,tls=118ms,negotiate=92ms]";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RDP licensing failure classification", () => {
  it.each([reported, reported.toUpperCase(), reported.replace(/, /g, ",\n")])(
    "classifies the reported server refusal before TLS and elapsed timing fields: %s",
    (message) => expect(classifyRdpError(message)).toBe("licensing"),
  );

  it.each([
    "InvalidClient",
    "NoLicenseServer",
    "NoLicense",
    "InvalidScope",
    "InvalidProductId",
    "InvalidMessageLen",
    "InvalidMac",
    "InvalidServerCertificate",
  ])("recognizes licensing packet failure %s", (code) => {
    expect(
      classifyRdpError(
        `LicensingErrorMessage { error_code: ${code}, state_transition: TotalAbort }`,
      ),
    ).toBe("licensing");
  });

  it.each([
    "LICENSE_ERROR_MESSAGE: ERR_NO_LICENSE_SERVER, ST_TOTAL_ABORT",
    "RDP licensing failed: ERR_INVALID_CLIENT (0x00000008)",
    "RDP licensing negotiation failed",
    "Remote Desktop licensing protocol error",
    "RDP license negotiation failed",
    "Remote Desktop disconnected because of an error in the licensing protocol.",
    "RDP Licensing Error Message: ERR_INVALID_CLIENT",
    "Server disconnected: ERRINFO_LICENSE_NO_LICENSE_SERVER",
    "RDP server disconnected: LicenseNoLicense",
    "RDP license server unavailable",
    "The remote session was disconnected because there are no Remote Desktop License Servers available to provide a license.",
    "The remote session was disconnected because there are no Remote Desktop client access licenses available for this computer.",
    "Remote Desktop licensing mode is not configured.",
  ])("recognizes explicit RDP licensing diagnostics: %s", (message) => {
    expect(classifyRdpError(message)).toBe("licensing");
  });

  it.each([
    "InvalidClient",
    "OAuth InvalidClient: client authentication failed",
    "HTTP 400 invalid_client",
    "The application license is expired",
    "License server unavailable",
    "TLS certificate validation failed",
    "RDP authentication failed: invalid password",
    "RDP authentication failed: InvalidClient",
    "RDP connection timed out",
    "LicensingErrorMessage { error_code: ValidClient, state_transition: NoTransition }",
    "LICENSE_ERROR_MESSAGE: STATUS_VALID_CLIENT, ST_NO_TRANSITION",
    "RDP Licensing Error Message: STATUS_VALID_CLIENT, ST_NO_TRANSITION",
    "RDP license server available; TLS handshake failed",
  ])(
    "does not mislabel unrelated failures or successful licensing status: %s",
    (message) => {
      expect(classifyRdpError(message)).not.toBe("licensing");
    },
  );

  it("provides administrator checks without claiming a proven missing-CAL cause or recommending bypasses", () => {
    const category = classifyRdpError(reported);
    expect(RDP_ERROR_CATEGORY_LABELS[category]).toBe("RDP Licensing Failure");
    const [cause] = buildRdpDiagnostics(category);
    expect(cause.title).toBe("RDP licensing refused");
    expect(cause.description).toMatch(/does not prove.*CALs/i);
    const steps = cause.remediation.join("\n");
    expect(steps).toMatch(/administrator/i);
    expect(steps).toContain("RD Licensing Diagnoser");
    expect(steps).toMatch(/license server/i);
    expect(steps).toMatch(/Per User.*Per Device/);
    expect(steps).toMatch(/CAL.*compatib/i);
    expect(steps).not.toMatch(
      /disable|ignore certificate|reset.*grace|delete.*registry|change.*password|vulnerable/i,
    );
  });
});

describe("RDP licensing error screen using the real classifier and hook", () => {
  it("shows licensing-specific guidance, preserves raw diagnostic details, and does nothing automatically", async () => {
    vi.useFakeTimers();
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    const retry = vi.fn();
    const raw = `${reported}\nDiagnostic token: [REDACTED]`;
    render(
      <RDPErrorScreen
        sessionId="licensing-fixture"
        hostname="rdp.example.test"
        errorMessage={raw}
        onRetry={retry}
        connectionDetails={{
          port: 3389,
          username: "fixture-user",
          password: "fixture-secret",
        }}
      />,
    );
    expect(screen.getByText("RDP Licensing Failure")).toBeInTheDocument();
    expect(screen.getByText("RDP licensing refused")).toBeInTheDocument();
    expect(screen.getByText(/RD Licensing Diagnoser/)).toBeInTheDocument();
    expect(
      screen.queryByText("TLS / Certificate error"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Authentication failure"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/AllowEncryptionOracle/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Microsoft RDS licensing troubleshooting",
      }),
    ).toHaveAttribute(
      "href",
      "https://learn.microsoft.com/en-us/troubleshoot/windows-server/remote/cannot-connect-rds-no-license-server",
    );
    expect(retry).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show raw error" }));
    expect(document.querySelector("pre")?.textContent).toBe(raw);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Copy Error" })),
    );
    expect(copy).toHaveBeenCalledWith(
      expect.stringContaining("Category: RDP Licensing Failure"),
    );
    expect(copy.mock.calls[0][0]).toContain(raw);
    expect(copy.mock.calls[0][0]).not.toContain("fixture-secret");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry after licensing checks" }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });
});
