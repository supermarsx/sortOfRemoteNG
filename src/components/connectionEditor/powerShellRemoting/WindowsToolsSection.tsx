import { MonitorCog } from "lucide-react";
import { Checkbox } from "../../ui/forms";
import { PowerShellEditorSection } from "./PowerShellEditorSection";
import type { PowerShellRemotingSectionProps } from "./types";

export function WindowsToolsSection({
  value,
  onChange,
}: PowerShellRemotingSectionProps) {
  return (
    <PowerShellEditorSection
      id="windows-tools"
      title="Windows Tools"
      description="Optional Windows management tools configured outside PowerShell Remoting."
      icon={<MonitorCog size={16} />}
    >
      <label className="flex items-start gap-2 text-sm text-[var(--color-textSecondary)]">
        <Checkbox
          aria-label="Enable separate Windows management tools"
          checked={value.windowsTools.enabled}
          onChange={(enabled) =>
            onChange({
              ...value,
              windowsTools: {
                enabled,
                settingsSource: "separateWinrmSettings",
              },
            })
          }
          variant="form"
        />
        <span>
          Enable Windows management tools for this connection
          <span className="mt-1 block text-xs text-[var(--color-textMuted)]">
            WMI and Windows management tools are separate from PowerShell
            Remoting. Their namespace, authentication, and transport stay in
            Windows Tools settings; WMI is never treated as PowerShell.
          </span>
        </span>
      </label>
    </PowerShellEditorSection>
  );
}
