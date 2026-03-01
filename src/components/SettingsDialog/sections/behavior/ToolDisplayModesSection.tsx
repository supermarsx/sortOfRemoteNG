import TOOL_ENTRIES from "./TOOL_ENTRIES";
import React from "react";
import { PanelRight, Globe } from "lucide-react";
import type { ToolDisplayMode, ToolDisplayModeOverride } from "../../../../types/settings";
import { Card, SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import { Select } from "../../../ui/forms";
const ToolDisplayModesSection: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<PanelRight className="w-4 h-4" />}
      title="Tool Display Modes"
    />
    <p className="text-[10px] text-[var(--color-textMuted)] -mt-2">
      Set a global default, then override per tool. &quot;Inherit&quot; uses the
      global default.
    </p>
    <Card>
      {/* Global default */}
      <div
        className="flex items-center justify-between gap-4 pb-3 mb-3 border-b border-[var(--color-border)]"
        data-setting-key="toolDisplayModes.globalDefault"
      >
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-sm font-medium text-[var(--color-text)]">
            Global Default
          </span>
        </div>
        <Select value={s.toolDisplayModes?.globalDefault ?? "popup"} onChange={(v: string) => u({
              toolDisplayModes: {
                ...defaultToolDisplayModes,
                ...s.toolDisplayModes,
                globalDefault: v as ToolDisplayMode,
              },
            })} options={[{ value: "popup", label: "Popup" }, { value: "tab", label: "Tab" }]} className="px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded  text-[var(--color-text)]" />
      </div>

      {/* Per-tool overrides */}
      {TOOL_ENTRIES.map((tool) => {
        const current = s.toolDisplayModes?.[tool.key] ?? "inherit";
        const resolved =
          current === "inherit"
            ? (s.toolDisplayModes?.globalDefault ?? "popup")
            : current;
        const Icon = tool.icon;
        return (
          <div
            key={tool.key}
            className="flex items-center justify-between gap-4"
            data-setting-key={`toolDisplayModes.${tool.key}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="w-3.5 h-3.5 text-[var(--color-textSecondary)] flex-shrink-0" />
              <span className="text-sm text-[var(--color-textSecondary)] truncate">
                {tool.label}
              </span>
              {current === "inherit" && (
                <span className="text-[10px] text-[var(--color-textMuted)] flex-shrink-0">
                  ({resolved})
                </span>
              )}
            </div>
            <Select value={current} onChange={(v: string) => u({
                  toolDisplayModes: {
                    ...defaultToolDisplayModes,
                    ...s.toolDisplayModes,
                    [tool.key]: v as ToolDisplayModeOverride,
                  },
                })} options={[{ value: "inherit", label: "Inherit" }, { value: "popup", label: "Popup" }, { value: "tab", label: "Tab" }]} className="px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded  text-[var(--color-text)]" />
          </div>
        );
      })}
    </Card>
  </div>
);

export default ToolDisplayModesSection;
