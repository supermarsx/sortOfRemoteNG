import React from "react";
import { Zap } from "lucide-react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import { Select } from "../../ui/forms";

const FOCUS_OPTIONS = [
  { value: "", label: "Use global setting" },
  { value: "true", label: "Focus tab" },
  { value: "false", label: "Open in background" },
] as const;

const parseFocusBool = (value: string): boolean | undefined =>
  value === "true" ? true : value === "false" ? false : undefined;

export const BehaviorSection: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => {
  const isWindows =
    mgr.formData.osType === "windows" ||
    (!mgr.formData.osType &&
      (mgr.formData.protocol === "rdp" || mgr.formData.protocol === "winrm"));

  return (
    <div
      data-editor-search-section="behavior-focus"
      className="space-y-2 border-t border-[var(--color-border)] pt-3"
    >
      <h3 className="text-xs font-semibold text-[var(--color-textSecondary)] flex items-center gap-1.5">
        <Zap size={12} /> Focus Behavior
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div data-editor-search-field="focus-on-connect">
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            On Connect
          </label>
          <Select
            value={
              mgr.formData.focusOnConnect === true
                ? "true"
                : mgr.formData.focusOnConnect === false
                  ? "false"
                  : ""
            }
            onChange={(value: string) =>
              mgr.setFormData({
                ...mgr.formData,
                focusOnConnect: parseFocusBool(value),
              })
            }
            options={FOCUS_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            variant="form"
          />
        </div>
        {isWindows && (
          <div data-editor-search-field="focus-on-winmgmt-tool">
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
              On Windows Management Tool
            </label>
            <Select
              value={
                mgr.formData.focusOnWinmgmtTool === true
                  ? "true"
                  : mgr.formData.focusOnWinmgmtTool === false
                    ? "false"
                    : ""
              }
              onChange={(value: string) =>
                mgr.setFormData({
                  ...mgr.formData,
                  focusOnWinmgmtTool: parseFocusBool(value),
                })
              }
              options={FOCUS_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              variant="form"
            />
          </div>
        )}
      </div>
    </div>
  );
};
