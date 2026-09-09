import React, { useId, useMemo } from "react";
import { Tag, PanelsTopLeft } from "lucide-react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import { TagManager } from "../TagManager";
import { ConnectionIconPicker } from "./ConnectionIconPicker";
import ApplicationIconSuggestion from "../../connectionEditor/httpOptions/ApplicationIconSuggestion";
import { useConnections } from "../../../contexts/useConnections";
import { Select } from "../../ui/forms/Select";
import { resolveDefaultTabGroup } from "../../../utils/session/resolveDefaultTabGroup";

export const DefaultTabGroupSection: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => {
  const { state } = useConnections();
  const selectorId = useId();
  const inheritedId = useMemo(() => {
    const parent = state.connections.find(
      (connection) =>
        connection.id === mgr.formData.parentId && connection.isGroup === true,
    );
    return resolveDefaultTabGroup(
      parent?.id,
      state.connections,
      state.tabGroups,
    );
  }, [mgr.formData.parentId, state.connections, state.tabGroups]);
  const inheritedGroup = state.tabGroups.find(
    (group) => group.id === inheritedId,
  );
  const selectedId = mgr.formData.defaultTabGroupId ?? "";
  const unavailable =
    selectedId !== "" &&
    !state.tabGroups.some((group) => group.id === selectedId);
  return (
    <div
      data-editor-search-section="organize-tab-group"
      data-editor-search-field="defaultTabGroupId"
    >
      <label
        htmlFor={selectorId}
        className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-textSecondary)]"
      >
        <PanelsTopLeft size={14} /> Default tab group
      </label>
      <Select
        id={selectorId}
        label="Default tab group"
        variant="form-sm"
        className="w-full max-w-sm"
        searchable
        value={selectedId}
        onChange={(value) =>
          mgr.setFormData((current) => ({
            ...current,
            defaultTabGroupId: value || undefined,
          }))
        }
        options={[
          {
            value: "",
            label: inheritedGroup
              ? `Inherit: ${inheritedGroup.name}`
              : "Inherit from parent folder (or no group)",
          },
          ...(unavailable
            ? [
                {
                  value: selectedId,
                  label: "Unavailable group — using inherited default",
                  disabled: true,
                },
              ]
            : []),
          ...state.tabGroups.map((group) => ({
            value: group.id,
            label: group.name,
          })),
        ]}
      />
      <p className="mt-2 max-w-xl text-xs text-[var(--color-textMuted)]">
        {mgr.formData.isGroup
          ? "Automatically groups new sessions for children, including nested and future connections. A connection's own default or a nearer folder takes priority. Open tabs are not moved."
          : "Overrides the parent folder default for new sessions. Open tabs are not moved."}
      </p>
      {state.tabGroups.length === 0 && (
        <p className="mt-1 text-xs text-[var(--color-textMuted)]">
          Create a tab group in Tab Group Manager or the session tab bar to
          choose it here.
        </p>
      )}
    </div>
  );
};

export const IconPicker: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div
    data-editor-search-section="organize-icon"
    data-editor-search-field="icon"
  >
    <h3 className="mb-2 text-xs font-semibold text-[var(--color-textSecondary)]">
      {mgr.formData.isGroup ? "Folder Icon" : "Connection Icon"}
    </h3>
    <ApplicationIconSuggestion
      formData={mgr.formData}
      setFormData={mgr.setFormData}
    />
    <ConnectionIconPicker
      connection={{
        icon: mgr.formData.icon,
        protocol: mgr.formData.protocol ?? "",
        integration: mgr.formData.integration,
        isGroup: mgr.formData.isGroup,
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
    <DefaultTabGroupSection mgr={mgr} />
    <IconPicker mgr={mgr} />
    <TagsSection mgr={mgr} />
  </>
);
