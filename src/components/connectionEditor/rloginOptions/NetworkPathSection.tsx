import { AlertTriangle, CheckCircle2, Network, XCircle } from "lucide-react";
import { RloginEditorSectionFrame } from "./Section";
import type { RloginNetworkPathSectionProps } from "./types";

export function RloginNetworkPathSection({
  settings,
  networkPath,
  validation,
}: RloginNetworkPathSectionProps) {
  const pathIssues =
    validation?.issues.filter(
      (issue) =>
        issue.field === "networkPath" || issue.field === "sourcePortMode",
    ) ?? [];

  return (
    <RloginEditorSectionFrame
      id="rlogin-network-path-section"
      title="Network Path"
      description="Review whether the selected shared proxy, VPN, or SSH-jump path can deliver a strict RLogin TCP stream."
      icon={<Network size={16} />}
    >
      <div
        id="rlogin-network-path-summary"
        tabIndex={-1}
        aria-live="polite"
        className={`rounded-md border px-3 py-3 ${
          networkPath.supported
            ? "border-success/30 bg-success/5"
            : "border-danger/35 bg-danger/10"
        }`}
      >
        <div className="flex items-start gap-2">
          {networkPath.supported ? (
            <CheckCircle2
              size={15}
              className="mt-0.5 shrink-0 text-success"
              aria-hidden
            />
          ) : (
            <XCircle
              size={15}
              className="mt-0.5 shrink-0 text-danger"
              aria-hidden
            />
          )}
          <div>
            <p className="text-xs font-semibold text-[var(--color-text)]">
              {networkPath.supported
                ? "TCP path supported"
                : "Connection blocked"}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-[var(--color-textSecondary)]">
              {networkPath.summary}
            </p>
          </div>
        </div>
      </div>

      {networkPath.layers.length > 0 ? (
        <ol className="space-y-2" aria-label="RLogin Network Path layers">
          {networkPath.layers.map((layer, index) => (
            <li
              key={`${layer.kind}-${index}-${layer.label}`}
              className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                {index + 1}
              </span>
              <span className="text-xs text-[var(--color-textSecondary)]">
                {layer.label}
              </span>
            </li>
          ))}
          <li className="pl-7 text-[11px] font-medium text-success">
            → RLogin target
          </li>
        </ol>
      ) : (
        <p className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-3 text-center text-xs text-[var(--color-textMuted)]">
          Direct TCP → RLogin target
        </p>
      )}

      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-4 text-[var(--color-textSecondary)]">
        <p className="font-semibold text-warning">Source-port limitation</p>
        <p className="mt-1">
          Reserved client ports cannot be guaranteed through any configured
          Network Path. Current policy:{" "}
          <strong>{settings.sourcePortMode}</strong>.
        </p>
      </div>

      {pathIssues.length > 0 ? (
        <ul className="space-y-2" aria-label="RLogin Network Path diagnostics">
          {pathIssues.map((issue) => (
            <li
              key={`${issue.code}-${issue.field}`}
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-4 ${
                issue.severity === "error"
                  ? "border-danger/30 bg-danger/5 text-danger"
                  : "border-warning/30 bg-warning/5 text-[var(--color-textSecondary)]"
              }`}
            >
              <AlertTriangle
                size={13}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </RloginEditorSectionFrame>
  );
}
