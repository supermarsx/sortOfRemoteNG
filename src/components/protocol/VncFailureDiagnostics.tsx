import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { useVncDiagnostics } from "../../hooks/protocol/useVncDiagnostics";
import {
  classifyVncFailure,
  validVncDiagnosticTarget,
  vncDiagnosticTarget,
  vncDiagnosticsText,
  vncOsErrorCode,
  vncDiagnosticFacts,
  vncDiagnosticStepMessage,
  vncTargetAddress,
  VNC_DIAGNOSTIC_MESSAGES,
} from "../../hooks/protocol/vncDiagnostics";
import { WebsiteDiagnosticsCopyButton } from "./webBrowser/WebsiteDiagnosticsCopyButton";

export function VncFailureDiagnostics({
  connection,
  session,
  error,
  retry,
}: {
  connection: Connection | undefined;
  session: ConnectionSession;
  error: string | null;
  retry: () => Promise<void>;
}) {
  const { request, path } = vncDiagnosticTarget(connection, session);
  const diagnostics = useVncDiagnostics(request);
  const failure = classifyVncFailure(error);
  const osCode = vncOsErrorCode(error);
  const blocked = request.route === "blocked";
  const valid = validVncDiagnosticTarget(request);
  const buttonClass =
    "inline-flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50";
  return (
    <section
      aria-label="VNC failure diagnostics"
      className="max-h-full w-full max-w-2xl overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm text-[var(--color-textSecondary)]"
    >
      <h2 className="mb-3 text-lg text-error">VNC Connection Failed</h2>
      <p role="alert">{VNC_DIAGNOSTIC_MESSAGES[failure]}</p>
      {osCode && <p className="mt-1 text-xs">OS error: {osCode}</p>}
      <dl className="my-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt>Target / port</dt>
        <dd className="break-all">
          {valid ? vncTargetAddress(request) : "Invalid target"}
        </dd>
        <dt>Network path</dt>
        <dd>{path}</dd>
      </dl>
      {blocked && (
        <p className="mb-3 text-warning">
          {VNC_DIAGNOSTIC_MESSAGES.routeBlocked}
        </p>
      )}
      <ul className="mb-4 list-disc space-y-1 pl-5">
        <li>
          Confirm the VNC service is running and listening on the target
          interface and port (usually 5900; display :1 commonly uses 5901).
        </li>
        <li>
          Check server firewall rules and any VPN or tunnel endpoint. A refusal
          alone does not prove the host is down or the password is wrong.
        </li>
        <li>
          For a security or authentication failure, inspect the server's
          supported security methods and logs before changing security settings.
        </li>
      </ul>
      <p className="mb-3 text-xs">
        Run checks opens a short TCP connection and reads the RFB greeting.
        Maximum 10 seconds; no VNC credentials, authentication, or desktop
        input. Host and port remain in copied diagnostics.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={diagnostics.running || blocked || !valid}
          onClick={() => void diagnostics.run()}
        >
          {diagnostics.running ? "Running checks…" : "Run VNC diagnostics"}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={diagnostics.running || blocked || !valid}
          onClick={() => void retry()}
        >
          Retry native VNC
        </button>
        <WebsiteDiagnosticsCopyButton
          label="Copy redacted diagnostics"
          className={buttonClass}
          text={vncDiagnosticsText(
            request,
            path,
            failure,
            diagnostics.report,
            osCode,
          )}
        />
      </div>
      <div role="status" aria-live="polite" className="mt-4">
        {diagnostics.running && (
          <p>Checking DNS, TCP, then the RFB greeting…</p>
        )}
        {diagnostics.report && (
          <>
            <p>{VNC_DIAGNOSTIC_MESSAGES[diagnostics.report.code]}</p>
            {vncDiagnosticFacts(diagnostics.report).map((fact) => (
              <p key={fact} className="mt-1 break-all text-xs">
                {fact}
              </p>
            ))}
            <ol className="mt-2 space-y-2">
              {diagnostics.report.steps.map((step) => (
                <li key={step.stage}>
                  <span className="font-medium">
                    {step.stage.toUpperCase()}: {step.status} ({step.durationMs}{" "}
                    ms)
                  </span>
                  <p className="text-xs">{vncDiagnosticStepMessage(step)}</p>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs">
              Elapsed: {diagnostics.report.durationMs} ms. A valid greeting does
              not verify authentication, encryption, or a usable desktop.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
