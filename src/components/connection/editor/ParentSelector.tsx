import React from "react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import { Select } from "../../ui/forms";

export const ParentSelector: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => {
  if (mgr.availableGroups.length === 0) return null;

  return (
    <div
      data-editor-search-section="general-parent"
      data-editor-search-field="parent-folder"
    >
      <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
        Parent Folder
      </label>
      <Select
        value={mgr.formData.parentId || ""}
        data-testid="editor-parent-folder"
        onChange={(value: string) =>
          mgr.setFormData({
            ...mgr.formData,
            parentId: value || undefined,
          })
        }
        options={[
          { value: "", label: "Root (No parent)" },
          ...mgr.selectableGroups.map(({ group, disabled, reason }) => ({
            value: group.id,
            label: `${group.name}
            ${disabled ? ` (${reason})` : ""}`,
            disabled,
            title: reason,
          })),
        ]}
        className="w-full px-4 py-2.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
      />
    </div>
  );
};
