import { AlertTriangle } from "lucide-react";
import { useComposedControlledValue } from "../useComposedControlledValue";
import { CURRENT_POWER_SHELL_REMOTING_CAPABILITIES } from "../../../utils/powershell/currentPowerShellCapabilities";
import { validatePowerShellRemotingSettings } from "../../../utils/powershell/normalizePowerShellRemoting";
import { AuthenticationSection } from "./AuthenticationSection";
import { EndpointSection } from "./EndpointSection";
import { NetworkPathSummarySection } from "./NetworkPathSummarySection";
import { SecuritySection } from "./SecuritySection";
import { SessionSection } from "./SessionSection";
import { SshSection } from "./SshSection";
import type { PowerShellRemotingEditorProps } from "./types";
import { WindowsToolsSection } from "./WindowsToolsSection";

/**
 * Standalone, flat PowerShell Remoting editor. Shared protocol routing can
 * mount these sections later without coupling the schema to WMI/WinRM tools.
 */
export function PowerShellRemotingEditor({
  targetHost,
  value,
  onChange,
  capabilities = CURRENT_POWER_SHELL_REMOTING_CAPABILITIES,
  networkPathSummary,
  sections,
}: PowerShellRemotingEditorProps) {
  const [liveValue, emitValue] = useComposedControlledValue(value, onChange);
  const issues = validatePowerShellRemotingSettings(
    value,
    targetHost || "host.invalid",
  );
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const sectionProps = {
    value: liveValue,
    onChange: emitValue,
    capabilities,
    targetHost,
  };
  const visible = (
    section: import("./types").PowerShellRemotingEditorSectionId,
  ) => !sections || sections.includes(section);

  return (
    <div
      className="space-y-4"
      data-testid="powershell-remoting-editor"
      data-editor-search-section="powershell-remoting-options"
    >
      <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-warning"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">
              Live sessions: persistent PSRP over SSH or direct WSMan
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-textMuted)]">
              The session viewer uses a persistent runspace with all standard
              streams, input, cancellation, and bounded replay. WSMan is
              deterministic-contract verified with strict Trust Center TLS; live
              Windows interoperability remains explicitly unverified.
            </p>
          </div>
        </div>
      </div>

      {blockingIssues.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-error/30 bg-error/5 px-4 py-3"
        >
          <p className="text-sm font-medium text-error">
            Fix {blockingIssues.length} blocking PowerShell setting
            {blockingIssues.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-error">
            {blockingIssues.map((issue) => (
              <li key={`${issue.path}:${issue.code}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {visible("endpoint") && <EndpointSection {...sectionProps} />}
      {visible("authentication") && <AuthenticationSection {...sectionProps} />}
      {visible("security") && <SecuritySection {...sectionProps} />}
      {visible("ssh") && <SshSection {...sectionProps} />}
      {visible("network-path") && (
        <NetworkPathSummarySection
          {...sectionProps}
          summary={networkPathSummary}
        />
      )}
      {visible("session") && <SessionSection {...sectionProps} />}
      {visible("windows-tools") && <WindowsToolsSection {...sectionProps} />}
    </div>
  );
}

export type {
  PowerShellRemotingEditorProps,
  PowerShellRemotingEditorSectionId,
} from "./types";
