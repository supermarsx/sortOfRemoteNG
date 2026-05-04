import { Activity, CheckCircle, XCircle, Clock, Loader2, AlertCircle, ChevronDown, ChevronUp, Info, Microscope } from "lucide-react";
import { Connection } from "../../../types/connection/connection";
import { DiagnosticsMgr } from "../../../hooks/connection/useConnectionDiagnostics";

const ProtocolDeepDiagSection = ({
  mgr,
  connection,
}: {
  mgr: DiagnosticsMgr;
  connection: Connection;
}) => {
  const {
    protocolReport,
    protocolDiagRunning,
    protocolDiagError,
    expandedProtoStep,
    setExpandedProtoStep,
  } = mgr;

  if (!protocolReport && !protocolDiagRunning && !protocolDiagError)
    return null;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-primary)]/40 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-[var(--color-primary)]/10 border-b border-[var(--color-primary)]/30">
        <Microscope size={14} className="text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">
          {connection.protocol.toUpperCase()} Deep Diagnostics
        </h3>
        {protocolReport && (
          <span className="ml-auto text-[10px] text-[var(--color-textSecondary)]">
            {protocolReport.protocol.toUpperCase()}{" "}
            {protocolReport.resolvedIp &&
              `${protocolReport.host} → ${protocolReport.resolvedIp}:${protocolReport.port}`}
            {protocolReport.totalDurationMs > 0 &&
              ` (${protocolReport.totalDurationMs}ms)`}
          </span>
        )}
      </div>

      {protocolDiagRunning && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-primary">
          <Loader2 size={14} className="animate-spin" />
          Running {connection.protocol.toUpperCase()} diagnostics…
        </div>
      )}

      {protocolDiagError && (
        <div className="px-4 py-3 text-sm text-error">
          Diagnostics failed: {protocolDiagError}
        </div>
      )}

      {protocolReport && (
        <div className="divide-y divide-[var(--color-border)]/40">
          {protocolReport.steps.map((step, idx) => {
            const isExpanded = expandedProtoStep === idx;
            const stepIcon =
              step.status === "pass" ? (
                <CheckCircle size={14} className="text-success" />
              ) : step.status === "fail" ? (
                <XCircle size={14} className="text-error" />
              ) : step.status === "warn" ? (
                <AlertCircle size={14} className="text-warning" />
              ) : step.status === "info" ? (
                <Info size={14} className="text-primary" />
              ) : (
                <Activity size={14} className="text-[var(--color-textMuted)]" />
              );

            return (
              <div key={`proto-step-${step.name}-${idx}`}>
                <button
                  onClick={() =>
                    setExpandedProtoStep((p) => (p === idx ? null : idx))
                  }
                  className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[var(--color-surfaceHover)] transition-colors"
                >
                  {stepIcon}
                  <span className="flex-1 text-xs text-[var(--color-text)]">
                    {step.name}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-[var(--color-textSecondary)]">
                    <Clock size={10} />
                    {step.durationMs}ms
                  </span>
                  {step.detail &&
                    (isExpanded ? (
                      <ChevronUp
                        size={12}
                        className="text-[var(--color-textMuted)]"
                      />
                    ) : (
                      <ChevronDown
                        size={12}
                        className="text-[var(--color-textMuted)]"
                      />
                    ))}
                </button>
                <div className="px-4 pb-1 -mt-0.5 pl-10">
                  <p
                    className={`text-[10px] ${
                      step.status === "fail"
                        ? "text-error"
                        : step.status === "warn"
                          ? "text-warning"
                          : step.status === "info"
                            ? "text-primary"
                            : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {step.message}
                  </p>
                </div>
                {isExpanded && step.detail && (
                  <div className="px-4 pb-2 pl-10">
                    <pre className="text-[10px] text-[var(--color-textSecondary)] whitespace-pre-wrap bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-2 mt-1">
                      {step.detail}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}

          {/* Summary */}
          <div className="px-4 py-3 space-y-2">
            <p className="text-xs text-[var(--color-text)]">
              <span className="font-semibold text-[var(--color-textSecondary)]">
                Summary:{" "}
              </span>
              {protocolReport.summary}
            </p>
            {protocolReport.rootCauseHint && (
              <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3">
                <h4 className="text-[10px] font-semibold text-warning uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <AlertCircle size={10} />
                  Root Cause Analysis
                </h4>
                <pre className="text-[10px] text-[var(--color-text)] whitespace-pre-wrap leading-relaxed">
                  {protocolReport.rootCauseHint}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProtocolDeepDiagSection;
