import React from "react";
import { Tag } from "lucide-react";
import {
  ICON_OPTIONS,
  type ConnectionEditorMgr,
} from "../../../hooks/connection/useConnectionEditor";
import { TagManager } from "../TagManager";

export const IconPicker: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div
    data-editor-search-section="organize-icon"
    data-editor-search-field="icon"
  >
    <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
      Custom Icon
    </label>
    <div className="flex flex-wrap gap-1.5">
      {ICON_OPTIONS.map(({ value, label, icon: Icon }) => {
        const isActive = (mgr.formData.icon || "") === value;
        return (
          <button
            key={value || "default"}
            type="button"
            onClick={() =>
              mgr.setFormData({ ...mgr.formData, icon: value || undefined })
            }
            className={`p-2 rounded-lg border transition-all ${
              isActive
                ? "border-primary/60 bg-primary/20 text-primary"
                : "border-[var(--color-border)] bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:border-[var(--color-border)]"
            }`}
            title={label}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </div>
  </div>
);

export const TagsSection: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => (
  <div
    data-editor-search-section="organize-tags"
    data-editor-search-field="tags"
  >
    <div className="flex items-center gap-1.5 mb-1">
      <Tag size={12} className="text-[var(--color-textSecondary)]" />
      <label className="text-xs font-medium text-[var(--color-textSecondary)]">
        Tags
      </label>
    </div>
    <TagManager
      tags={mgr.formData.tags || []}
      availableTags={mgr.allTags}
      onChange={mgr.handleTagsChange}
      onCreateTag={() => {}}
    />
  </div>
);

export const OrganizeSection: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => (
  <>
    <IconPicker mgr={mgr} />
    <TagsSection mgr={mgr} />
  </>
);
