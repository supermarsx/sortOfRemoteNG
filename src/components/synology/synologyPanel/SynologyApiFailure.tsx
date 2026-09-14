import { WebsiteDiagnosticsCopyButton } from "../../protocol/webBrowser/WebsiteDiagnosticsCopyButton";
import {
  parseSynologyApiFailure,
  synologyApiFailurePresentation,
  hasSynologyDiagnostic,
} from "../../../utils/synology/apiFailureDiagnostic";

export default function SynologyApiFailure({
  error,
  alert = true,
}: {
  error: string;
  alert?: boolean;
}) {
  const diagnostic = parseSynologyApiFailure(error);
  const presentation = diagnostic
    ? synologyApiFailurePresentation(diagnostic)
    : null;
  return (
    <div
      role={alert ? "alert" : undefined}
      className="space-y-2 break-words text-sm text-[var(--color-textSecondary)]"
    >
      <p>
        {presentation?.summary ??
          (hasSynologyDiagnostic(error)
            ? "The NAS API request failed; diagnostic metadata was unavailable."
            : error)}
      </p>
      {presentation && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--color-text)]">
              API failure details
            </span>
            <WebsiteDiagnosticsCopyButton text={presentation.copy} />
          </div>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {presentation.rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt>{label}</dt>
                <dd
                  title={
                    label === "Response bytes inspected"
                      ? `${diagnostic!.bytesRead} bytes inspected in memory; not necessarily the full response size. No body is stored in these diagnostics.`
                      : undefined
                  }
                  className="min-w-0 break-words text-[var(--color-text)]"
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <p className="text-xs">No automatic sign-in retry was made.</p>
    </div>
  );
}
