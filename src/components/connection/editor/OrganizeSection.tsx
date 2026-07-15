import React from "react";
import { Tag } from "lucide-react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import { TagManager } from "../TagManager";
import { ConnectionIconPicker } from "./ConnectionIconPicker";

export const IconPicker: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div
    data-editor-search-section="organize-icon"
    data-editor-search-field="icon"
  >
    <h3 className="mb-2 text-xs font-semibold text-[var(--color-textSecondary)]">
      Connection Icon
    </h3>
    <ConnectionIconPicker
      connection={{
        icon: mgr.formData.icon,
        protocol: mgr.formData.protocol ?? "",
        integration: mgr.formData.integration,
      }}
      onChange={(icon) => mgr.setFormData((current) => ({ ...current, icon }))}
    />
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
