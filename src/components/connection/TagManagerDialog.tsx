import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Link2,
  Palette,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Unlink,
  Users,
  X,
} from "lucide-react";
import { EmptyState } from "../ui/display";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import { useConnections } from "../../contexts/useConnections";
import { PREDEFINED_COLORS } from "../../hooks/connection/useColorTagManager";
import {
  useTagManagement,
  type ColorTagRecord,
  type TagActionResult,
  type TextTagRecord,
} from "../../hooks/connection/useTagManagement";
import type { Connection } from "../../types/connection/connection";

interface TagManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ActiveView = "text" | "color";
type UsageFilter = "all" | "used" | "unused";

type AssignmentTarget =
  | { kind: "text"; key: string; name: string }
  | { kind: "color"; id: string; name: string };

type DeleteConfirmState =
  | { kind: "text"; name: string; count: number }
  | { kind: "color"; id: string; name: string; count: number }
  | null;

interface QuickTarget {
  id: string;
  label: string;
  connectionIds: string[];
}

const DEFAULT_COLOR = "#3b82f6";
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

const normalizeSearch = (value: string): string =>
  value.trim().toLocaleLowerCase();

const textTagKey = (name: string): string => normalizeSearch(name);

const connectionCountLabel = (count: number): string =>
  `${count} ${count === 1 ? "connection" : "connections"}`;

const normalizeHex = (raw: string): string | null => {
  const trimmed = raw.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (HEX_PATTERN.test(withHash)) return withHash.toLocaleLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const [, red, green, blue] = withHash;
    return `#${red}${red}${green}${green}${blue}${blue}`.toLocaleLowerCase();
  }
  return null;
};

const connectionSubtitle = (connection: Connection): string => {
  const parts = [connection.protocol.toUpperCase(), connection.hostname].filter(
    Boolean,
  );
  return parts.join(" - ");
};

const resultFailureMessage = (result: TagActionResult): string => {
  if (result.ok) return "Done.";

  switch (result.reason) {
    case "empty-name":
      return "Name is required.";
    case "no-target-connections":
      return "Choose at least one target connection.";
    case "no-matching-connections":
      return "No matching target connections.";
    case "tag-not-found":
      return "Text tag was not found.";
    case "color-tag-not-found":
      return "Color tag was not found.";
    case "already-assigned":
      return "Selected connections already have this tag.";
    default:
      return "No changes made.";
  }
};

const mergeSelectedIds = (
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  connectionIds: string[],
) => {
  setter(new Set(connectionIds));
};

const toggleSelectedId = (
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  connectionId: string,
) => {
  setter((previousIds) => {
    const nextIds = new Set(previousIds);
    if (nextIds.has(connectionId)) nextIds.delete(connectionId);
    else nextIds.add(connectionId);
    return nextIds;
  });
};

const toggleExpandedKey = (
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  key: string,
) => {
  setter((previousKeys) => {
    const nextKeys = new Set(previousKeys);
    if (nextKeys.has(key)) nextKeys.delete(key);
    else nextKeys.add(key);
    return nextKeys;
  });
};

const matchingConnectionsForSearch = (
  connections: Connection[],
  searchQuery: string,
): Connection[] => {
  if (!searchQuery) return connections;

  const matches = connections.filter((connection) => {
    const haystack = [
      connection.name,
      connection.hostname,
      connection.protocol,
      connection.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(searchQuery);
  });

  return matches.length > 0 ? matches : connections;
};

const previewConnectionNames = (connections: Connection[]): string => {
  if (connections.length === 0) return "No connections";
  const visibleNames = connections.slice(0, 4).map((connection) => connection.name);
  const remainingCount = connections.length - visibleNames.length;
  return remainingCount > 0
    ? `${visibleNames.join(", ")} +${remainingCount}`
    : visibleNames.join(", ");
};

export const TagManagerDialog: React.FC<TagManagerDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { state } = useConnections();
  const {
    connections,
    textTags,
    colorTags,
    stats,
    dedupeTags,
    createTextTag,
    renameTextTag,
    deleteTextTag,
    assignTextTagToConnections,
    removeTextTagFromConnection,
    createColorTag,
    updateColorTag,
    deleteColorTag,
    assignColorTagToConnections,
    clearColorTagFromConnection,
  } = useTagManagement();

  const [activeView, setActiveView] = useState<ActiveView>("text");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [searchFilter, setSearchFilter] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [showTextCreateForm, setShowTextCreateForm] = useState(true);
  const [textCreateName, setTextCreateName] = useState("");
  const [textCreateTargetIds, setTextCreateTargetIds] = useState<Set<string>>(
    new Set(),
  );

  const [showColorCreateForm, setShowColorCreateForm] = useState(true);
  const [colorCreateForm, setColorCreateForm] = useState({
    name: "",
    color: DEFAULT_COLOR,
    global: true,
  });

  const [expandedTextTagKeys, setExpandedTextTagKeys] = useState<Set<string>>(
    new Set(),
  );
  const [expandedColorTagIds, setExpandedColorTagIds] = useState<Set<string>>(
    new Set(),
  );

  const [editingTextKey, setEditingTextKey] = useState<string | null>(null);
  const [editingTextName, setEditingTextName] = useState("");
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [editingColorForm, setEditingColorForm] = useState({
    name: "",
    color: DEFAULT_COLOR,
    global: true,
  });

  const [assignmentTarget, setAssignmentTarget] =
    useState<AssignmentTarget | null>(null);
  const [assignmentTargetIds, setAssignmentTargetIds] = useState<Set<string>>(
    new Set(),
  );
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null);

  const searchQuery = normalizeSearch(searchFilter);

  const nonGroupConnections = useMemo(
    () =>
      connections
        .filter((connection) => !connection.isGroup)
        .sort((leftConnection, rightConnection) =>
          leftConnection.name.localeCompare(rightConnection.name),
        ),
    [connections],
  );

  const nonGroupConnectionIds = useMemo(
    () => new Set(nonGroupConnections.map((connection) => connection.id)),
    [nonGroupConnections],
  );

  const validColorTagIds = useMemo(
    () => new Set(colorTags.map((colorTag) => colorTag.id)),
    [colorTags],
  );

  const selectedTreeTargetIds = useMemo(
    () =>
      Array.from(state.selectedConnectionIds).filter((connectionId) =>
        nonGroupConnectionIds.has(connectionId),
      ),
    [nonGroupConnectionIds, state.selectedConnectionIds],
  );

  const textUntaggedTargetIds = useMemo(
    () =>
      nonGroupConnections
        .filter((connection) => dedupeTags(connection.tags ?? []).length === 0)
        .map((connection) => connection.id),
    [dedupeTags, nonGroupConnections],
  );

  const colorUntaggedTargetIds = useMemo(
    () =>
      nonGroupConnections
        .filter(
          (connection) =>
            !connection.colorTag || !validColorTagIds.has(connection.colorTag),
        )
        .map((connection) => connection.id),
    [nonGroupConnections, validColorTagIds],
  );

  const managerFilteredTargetIds = useMemo(() => {
    if (!searchQuery) return nonGroupConnections.map((connection) => connection.id);

    return nonGroupConnections
      .filter((connection) => {
        const haystack = [
          connection.name,
          connection.hostname,
          connection.protocol,
          connection.description,
          ...(connection.tags ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        return haystack.includes(searchQuery);
      })
      .map((connection) => connection.id);
  }, [nonGroupConnections, searchQuery]);

  const textQuickTargets = useMemo<QuickTarget[]>(
    () => [
      {
        id: "selected-tree",
        label: "Selected",
        connectionIds: selectedTreeTargetIds,
      },
      {
        id: "untagged-text",
        label: "Untagged",
        connectionIds: textUntaggedTargetIds,
      },
      {
        id: "filtered-manager",
        label: "Filtered",
        connectionIds: managerFilteredTargetIds,
      },
    ],
    [managerFilteredTargetIds, selectedTreeTargetIds, textUntaggedTargetIds],
  );

  const colorQuickTargets = useMemo<QuickTarget[]>(
    () => [
      {
        id: "selected-tree",
        label: "Selected",
        connectionIds: selectedTreeTargetIds,
      },
      {
        id: "no-color",
        label: "No color",
        connectionIds: colorUntaggedTargetIds,
      },
      {
        id: "filtered-manager",
        label: "Filtered",
        connectionIds: managerFilteredTargetIds,
      },
    ],
    [colorUntaggedTargetIds, managerFilteredTargetIds, selectedTreeTargetIds],
  );

  const filteredTextTags = useMemo(() => {
    return textTags.filter((record) => {
      if (usageFilter === "unused") return false;
      if (usageFilter === "used" && record.count === 0) return false;
      if (!searchQuery) return true;

      return (
        record.name.toLocaleLowerCase().includes(searchQuery) ||
        record.connections.some((connection) => {
          const haystack = [connection.name, connection.hostname, connection.protocol]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase();
          return haystack.includes(searchQuery);
        })
      );
    });
  }, [searchQuery, textTags, usageFilter]);

  const filteredColorTags = useMemo(() => {
    return colorTags.filter((record) => {
      if (usageFilter === "used" && record.count === 0) return false;
      if (usageFilter === "unused" && record.count > 0) return false;
      if (!searchQuery) return true;

      return (
        record.name.toLocaleLowerCase().includes(searchQuery) ||
        record.connections.some((connection) => {
          const haystack = [connection.name, connection.hostname, connection.protocol]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase();
          return haystack.includes(searchQuery);
        })
      );
    });
  }, [colorTags, searchQuery, usageFilter]);

  const usageCounts = useMemo(() => {
    const currentRecords = activeView === "text" ? textTags : colorTags;
    return {
      all: currentRecords.length,
      used: currentRecords.filter((record) => record.count > 0).length,
      unused:
        activeView === "color"
          ? colorTags.filter((record) => record.count === 0).length
          : 0,
    };
  }, [activeView, colorTags, textTags]);

  const textCreateDisabled =
    !textCreateName.trim() || textCreateTargetIds.size === 0;
  const colorCreateDisabled = !colorCreateForm.name.trim();

  const applyResultMessage = useCallback(
    (result: TagActionResult, successMessage: string) => {
      setStatusMessage(result.ok ? successMessage : resultFailureMessage(result));
    },
    [],
  );

  const handleCreateTextTag = useCallback(() => {
    const targetIds = Array.from(textCreateTargetIds);
    const normalizedName = textCreateName.trim();
    const result = createTextTag(normalizedName, targetIds);
    applyResultMessage(
      result,
      `Applied "${normalizedName}" to ${connectionCountLabel(
        result.ok ? result.updatedConnections : 0,
      )}.`,
    );
    if (!result.ok) return;

    setTextCreateName("");
    setTextCreateTargetIds(new Set());
    setShowTextCreateForm(false);
  }, [applyResultMessage, createTextTag, textCreateName, textCreateTargetIds]);

  const handleCreateColorTag = useCallback(async () => {
    const result = await createColorTag(colorCreateForm);
    applyResultMessage(result, `Created "${colorCreateForm.name.trim()}".`);
    if (!result.ok) return;

    setColorCreateForm({ name: "", color: DEFAULT_COLOR, global: true });
    setShowColorCreateForm(false);
  }, [applyResultMessage, colorCreateForm, createColorTag]);

  const handleStartTextRename = useCallback((record: TextTagRecord) => {
    setEditingTextKey(textTagKey(record.name));
    setEditingTextName(record.name);
  }, []);

  const handleCommitTextRename = useCallback(
    (record: TextTagRecord) => {
      const result = renameTextTag(record.name, editingTextName);
      applyResultMessage(result, `Renamed "${record.name}".`);
      if (!result.ok) return;

      setEditingTextKey(null);
      setEditingTextName("");
    },
    [applyResultMessage, editingTextName, renameTextTag],
  );

  const handleStartColorEdit = useCallback((record: ColorTagRecord) => {
    setEditingColorId(record.id);
    setEditingColorForm({
      name: record.name,
      color: record.color,
      global: record.global,
    });
  }, []);

  const handleCommitColorEdit = useCallback(
    async (record: ColorTagRecord) => {
      const result = await updateColorTag(record.id, editingColorForm);
      applyResultMessage(result, `Updated "${editingColorForm.name.trim()}".`);
      if (!result.ok) return;

      setEditingColorId(null);
      setEditingColorForm({ name: "", color: DEFAULT_COLOR, global: true });
    },
    [applyResultMessage, editingColorForm, updateColorTag],
  );

  const handleStartTextAssignment = useCallback((record: TextTagRecord) => {
    const key = textTagKey(record.name);
    setAssignmentTarget({ kind: "text", key, name: record.name });
    setAssignmentTargetIds(new Set());
    setExpandedTextTagKeys((previousKeys) => new Set(previousKeys).add(key));
  }, []);

  const handleStartColorAssignment = useCallback((record: ColorTagRecord) => {
    setAssignmentTarget({ kind: "color", id: record.id, name: record.name });
    setAssignmentTargetIds(new Set());
    setExpandedColorTagIds((previousIds) => new Set(previousIds).add(record.id));
  }, []);

  const handleCommitAssignment = useCallback(() => {
    if (!assignmentTarget) return;

    const targetIds = Array.from(assignmentTargetIds);
    const result =
      assignmentTarget.kind === "text"
        ? assignTextTagToConnections(assignmentTarget.name, targetIds)
        : assignColorTagToConnections(assignmentTarget.id, targetIds);

    applyResultMessage(
      result,
      result.ok && result.updatedConnections === 0
        ? "No connection changes needed."
        : `Assigned ${connectionCountLabel(
            result.ok ? result.updatedConnections : 0,
          )}.`,
    );

    if (!result.ok) return;
    setAssignmentTarget(null);
    setAssignmentTargetIds(new Set());
  }, [
    applyResultMessage,
    assignColorTagToConnections,
    assignTextTagToConnections,
    assignmentTarget,
    assignmentTargetIds,
  ]);

  const handleCancelAssignment = useCallback(() => {
    setAssignmentTarget(null);
    setAssignmentTargetIds(new Set());
  }, []);

  const handleRemoveTextFromConnection = useCallback(
    (record: TextTagRecord, connection: Connection) => {
      const result = removeTextTagFromConnection(record.name, connection.id);
      applyResultMessage(result, `Removed from "${connection.name}".`);
    },
    [applyResultMessage, removeTextTagFromConnection],
  );

  const handleClearColorFromConnection = useCallback(
    (connection: Connection) => {
      const result = clearColorTagFromConnection(connection.id);
      applyResultMessage(result, `Cleared color from "${connection.name}".`);
    },
    [applyResultMessage, clearColorTagFromConnection],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;

    if (deleteConfirm.kind === "text") {
      const result = deleteTextTag(deleteConfirm.name);
      applyResultMessage(result, `Removed "${deleteConfirm.name}".`);
    } else {
      const result = await deleteColorTag(deleteConfirm.id);
      applyResultMessage(result, `Deleted "${deleteConfirm.name}".`);
    }

    setDeleteConfirm(null);
  }, [applyResultMessage, deleteColorTag, deleteConfirm, deleteTextTag]);

  const renderCreateAction = () => {
    const isText = activeView === "text";
    const isVisible = isText ? showTextCreateForm : showColorCreateForm;
    if (isVisible) return null;

    return (
      <button
        type="button"
        onClick={() => {
          if (isText) setShowTextCreateForm(true);
          else setShowColorCreateForm(true);
        }}
        className="sor-btn-primary-sm flex-shrink-0"
      >
        <Plus size={14} />
        <span>{isText ? "New Text Tag" : "New Color Tag"}</span>
      </button>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2 min-w-0">
                  <Tag className="w-5 h-5 text-primary flex-shrink-0" />
                  <span className="truncate">Tag Manager</span>
                </h3>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {renderCreateAction()}
                <button
                  type="button"
                  onClick={onClose}
                  className="sor-icon-btn-sm"
                  title="Close Tag Manager"
                  aria-label="Close Tag Manager"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="text-xs text-[var(--color-textSecondary)] space-y-1">
              <p>
                Label connections with free-form text tags and a curated
                palette of color tags so you can slice the sidebar by purpose
                (production, staging, customer-X, on-call rotation) instead
                of relying on folder structure alone.
              </p>
              <p className="text-[var(--color-textMuted)]">
                Text tags are free-form strings stored on each connection;
                they appear in the connection editor and feed the sidebar
                filter chips. Color tags are a shared palette saved with the
                database — assign one per connection to tint its tab and
                tree-row dot, and use the filter chips above the connection
                list to scope by color. Use the Assign action to apply a
                tag to many connections at once; renames and deletes here
                update every connection that referenced the tag.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatPill label="Text" value={stats.totalTextTags} />
              <StatPill label="Color" value={stats.totalColorTags} />
              <StatPill label="Tagged" value={stats.taggedConnectionCount} />
              <StatPill label="Untagged" value={stats.untaggedConnectionCount} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex gap-1 rounded-lg bg-[var(--color-border)]/40 p-1">
              {(
                [
                  {
                    id: "text",
                    label: "Text Tags",
                    icon: Tag,
                    count: textTags.length,
                  },
                  {
                    id: "color",
                    label: "Color Tags",
                    icon: Palette,
                    count: colorTags.length,
                  },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const isActive = activeView === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveView(tab.id);
                      if (tab.id === "text" && usageFilter === "unused") {
                        setUsageFilter("all");
                      }
                      setStatusMessage(null);
                    }}
                    className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-[var(--color-surface)] text-primary shadow-sm"
                        : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                    }`}
                    aria-pressed={isActive}
                  >
                    <Icon size={13} />
                    <span className="truncate">{tab.label}</span>
                    <span className="text-[10px] rounded-full bg-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-textMuted)]">
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]"
              />
              <input
                type="text"
                value={searchFilter}
                onChange={(event) => setSearchFilter(event.target.value)}
                className="sor-form-input-xs sor-form-input-xs-icon-left w-full"
                placeholder="Search tags or connections..."
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              {(
                [
                  { key: "all", label: `All (${usageCounts.all})` },
                  { key: "used", label: `In use (${usageCounts.used})` },
                  ...(activeView === "color"
                    ? [
                        {
                          key: "unused" as const,
                          label: `Unused (${usageCounts.unused})`,
                        },
                      ]
                    : []),
                ] as const
              ).map((filterOption) => (
                <button
                  key={filterOption.key}
                  type="button"
                  onClick={() => setUsageFilter(filterOption.key)}
                  className={`px-2 py-0.5 rounded-full border transition-colors ${
                    usageFilter === filterOption.key
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "bg-[var(--color-border)]/40 border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                  }`}
                  aria-pressed={usageFilter === filterOption.key}
                >
                  {filterOption.label}
                </button>
              ))}

              {(searchFilter || usageFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchFilter("");
                    setUsageFilter("all");
                  }}
                  className="ml-auto text-[var(--color-textMuted)] hover:text-[var(--color-text)] underline underline-offset-2"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {statusMessage && (
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-border)]/30 px-3 py-2 text-xs text-[var(--color-textSecondary)] flex items-center justify-between gap-3">
              <span>{statusMessage}</span>
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                className="sor-icon-btn-sm flex-shrink-0"
                title="Dismiss"
                aria-label="Dismiss status"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {activeView === "text" ? (
            <div className="space-y-3">
              {showTextCreateForm && (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
                      <Plus size={14} className="text-primary" />
                      New Text Tag
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        setShowTextCreateForm(false);
                        setTextCreateName("");
                        setTextCreateTargetIds(new Set());
                      }}
                      className="sor-icon-btn-sm"
                      title="Cancel"
                      aria-label="Cancel new text tag"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="new-text-tag-name"
                      className="block text-[11px] font-medium text-[var(--color-textSecondary)]"
                    >
                      Name
                    </label>
                    <input
                      id="new-text-tag-name"
                      type="text"
                      value={textCreateName}
                      onChange={(event) => setTextCreateName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !textCreateDisabled) {
                          event.preventDefault();
                          handleCreateTextTag();
                        }
                      }}
                      className="sor-form-input-xs w-full"
                      placeholder="Tag name"
                    />
                  </div>

                  <ConnectionTargetSelector
                    connections={nonGroupConnections}
                    selectedIds={textCreateTargetIds}
                    onToggle={(connectionId) =>
                      toggleSelectedId(setTextCreateTargetIds, connectionId)
                    }
                    onReplace={(connectionIds) =>
                      mergeSelectedIds(setTextCreateTargetIds, connectionIds)
                    }
                    onClear={() => setTextCreateTargetIds(new Set())}
                    quickTargets={textQuickTargets}
                    emptyMessage="No connection targets available"
                  />

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setTextCreateTargetIds(new Set())}
                      className="sor-btn-secondary-sm"
                      disabled={textCreateTargetIds.size === 0}
                    >
                      Clear Targets
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateTextTag}
                      disabled={textCreateDisabled}
                      className="sor-btn-primary-sm"
                    >
                      <Check size={14} />
                      <span>Create Tag</span>
                    </button>
                  </div>
                </div>
              )}

              {textTags.length === 0 ? (
                <EmptyState
                  icon={Tag}
                  iconSize={48}
                  message="No text tags yet"
                  hint="Choose target connections, then create a tag."
                  className="py-12"
                />
              ) : filteredTextTags.length === 0 ? (
                <EmptyState
                  icon={Search}
                  iconSize={40}
                  message="No text tags match"
                  hint="Adjust search or filters."
                  className="py-8"
                />
              ) : (
                <div className="space-y-2">
                  {filteredTextTags.map((record) => {
                    const recordKey = textTagKey(record.name);
                    const isExpanded = expandedTextTagKeys.has(recordKey);
                    const isEditing = editingTextKey === recordKey;
                    const isAssigning =
                      assignmentTarget?.kind === "text" &&
                      assignmentTarget.key === recordKey;
                    const visibleConnections = matchingConnectionsForSearch(
                      record.connections,
                      searchQuery,
                    );
                    const assignmentCandidates = nonGroupConnections.filter(
                      (connection) => !record.connectionIds.includes(connection.id),
                    );

                    return (
                      <div
                        key={recordKey}
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-border)]/30 transition-colors"
                      >
                        <div className="flex items-center gap-2 p-3">
                          <button
                            type="button"
                            onClick={() =>
                              toggleExpandedKey(setExpandedTextTagKeys, recordKey)
                            }
                            className="sor-icon-btn-sm flex-shrink-0"
                            title={isExpanded ? "Collapse row" : "Expand row"}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${
                              record.name
                            }`}
                          >
                            {isExpanded ? (
                              <ChevronUp size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                          </button>

                          <Tag size={14} className="text-primary flex-shrink-0" />

                          {isEditing ? (
                            <input
                              type="text"
                              value={editingTextName}
                              onChange={(event) =>
                                setEditingTextName(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  handleCommitTextRename(record);
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  setEditingTextKey(null);
                                  setEditingTextName("");
                                }
                              }}
                              className="sor-form-input-xs flex-1 min-w-0"
                              aria-label={`Rename ${record.name}`}
                              autoFocus
                            />
                          ) : (
                            <span className="text-sm font-medium text-[var(--color-text)] truncate flex-1 min-w-0">
                              {record.name}
                            </span>
                          )}

                          <span className="text-[10px] text-[var(--color-textMuted)] bg-[var(--color-border)]/70 px-1.5 py-0.5 rounded-md flex-shrink-0">
                            {connectionCountLabel(record.count)}
                          </span>

                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleCommitTextRename(record)}
                                  className="sor-icon-btn-sm text-success"
                                  title="Save rename"
                                  aria-label={`Save ${record.name}`}
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTextKey(null);
                                    setEditingTextName("");
                                  }}
                                  className="sor-icon-btn-sm"
                                  title="Cancel rename"
                                  aria-label={`Cancel rename ${record.name}`}
                                >
                                  <X size={13} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleStartTextAssignment(record)}
                                  className="sor-icon-btn-sm"
                                  title="Assign to connections"
                                  aria-label={`Assign ${record.name} to connections`}
                                >
                                  <Link2 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleStartTextRename(record)}
                                  className="sor-icon-btn-sm"
                                  title="Rename"
                                  aria-label={`Rename ${record.name}`}
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteConfirm({
                                      kind: "text",
                                      name: record.name,
                                      count: record.count,
                                    })
                                  }
                                  className="sor-icon-btn-danger"
                                  title="Delete from all connections"
                                  aria-label={`Delete ${record.name}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {!isExpanded && record.connections.length > 0 && (
                          <div className="px-3 pb-2 text-[11px] text-[var(--color-textMuted)] truncate">
                            {previewConnectionNames(record.connections)}
                          </div>
                        )}

                        {isExpanded && (
                          <div className="border-t border-[var(--color-border)] p-3 space-y-3">
                            <ConnectionMemberList
                              connections={visibleConnections}
                              emptyMessage="No member connections"
                              actionLabel="Remove tag"
                              onAction={(connection) =>
                                handleRemoveTextFromConnection(record, connection)
                              }
                            />

                            {isAssigning && (
                              <AssignmentPanel
                                title="Assign to Connections"
                                selectedCount={assignmentTargetIds.size}
                                canSubmit={assignmentTargetIds.size > 0}
                                onSubmit={handleCommitAssignment}
                                onCancel={handleCancelAssignment}
                              >
                                <ConnectionTargetSelector
                                  connections={assignmentCandidates}
                                  selectedIds={assignmentTargetIds}
                                  onToggle={(connectionId) =>
                                    toggleSelectedId(
                                      setAssignmentTargetIds,
                                      connectionId,
                                    )
                                  }
                                  onReplace={(connectionIds) =>
                                    mergeSelectedIds(
                                      setAssignmentTargetIds,
                                      connectionIds,
                                    )
                                  }
                                  onClear={() => setAssignmentTargetIds(new Set())}
                                  quickTargets={textQuickTargets}
                                  emptyMessage="Every target already has this tag"
                                />
                              </AssignmentPanel>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {showColorCreateForm && (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
                      <Palette size={14} className="text-primary" />
                      New Color Tag
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        setShowColorCreateForm(false);
                        setColorCreateForm({
                          name: "",
                          color: DEFAULT_COLOR,
                          global: true,
                        });
                      }}
                      className="sor-icon-btn-sm"
                      title="Cancel"
                      aria-label="Cancel new color tag"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div className="space-y-1">
                      <label
                        htmlFor="new-color-tag-name"
                        className="block text-[11px] font-medium text-[var(--color-textSecondary)]"
                      >
                        Name
                      </label>
                      <input
                        id="new-color-tag-name"
                        type="text"
                        value={colorCreateForm.name}
                        onChange={(event) =>
                          setColorCreateForm((previousForm) => ({
                            ...previousForm,
                            name: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !colorCreateDisabled) {
                            event.preventDefault();
                            void handleCreateColorTag();
                          }
                        }}
                        className="sor-form-input-xs w-full"
                        placeholder="Color tag name"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)] cursor-pointer pb-1">
                      <input
                        type="checkbox"
                        checked={colorCreateForm.global}
                        onChange={(event) =>
                          setColorCreateForm((previousForm) => ({
                            ...previousForm,
                            global: event.target.checked,
                          }))
                        }
                        className="sor-form-checkbox"
                      />
                      Global
                    </label>
                  </div>

                  <ColorControls
                    color={colorCreateForm.color}
                    onChange={(color) =>
                      setColorCreateForm((previousForm) => ({
                        ...previousForm,
                        color,
                      }))
                    }
                  />

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setColorCreateForm({
                          name: "",
                          color: DEFAULT_COLOR,
                          global: true,
                        })
                      }
                      className="sor-btn-secondary-sm"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCreateColorTag()}
                      disabled={colorCreateDisabled}
                      className="sor-btn-primary-sm"
                    >
                      <Check size={14} />
                      <span>Create Color</span>
                    </button>
                  </div>
                </div>
              )}

              {colorTags.length === 0 ? (
                <EmptyState
                  icon={Palette}
                  iconSize={48}
                  message="No color tags yet"
                  hint="Create a color tag, then assign it to connections."
                  className="py-12"
                />
              ) : filteredColorTags.length === 0 ? (
                <EmptyState
                  icon={Search}
                  iconSize={40}
                  message="No color tags match"
                  hint="Adjust search or filters."
                  className="py-8"
                />
              ) : (
                <div className="space-y-2">
                  {filteredColorTags.map((record) => {
                    const isExpanded = expandedColorTagIds.has(record.id);
                    const isEditing = editingColorId === record.id;
                    const isAssigning =
                      assignmentTarget?.kind === "color" &&
                      assignmentTarget.id === record.id;
                    const visibleConnections = matchingConnectionsForSearch(
                      record.connections,
                      searchQuery,
                    );
                    const assignmentCandidates = nonGroupConnections.filter(
                      (connection) => connection.colorTag !== record.id,
                    );

                    return (
                      <div
                        key={record.id}
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-border)]/30 transition-colors"
                      >
                        <div className="flex items-center gap-2 p-3">
                          <button
                            type="button"
                            onClick={() =>
                              toggleExpandedKey(setExpandedColorTagIds, record.id)
                            }
                            className="sor-icon-btn-sm flex-shrink-0"
                            title={isExpanded ? "Collapse row" : "Expand row"}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${
                              record.name
                            }`}
                          >
                            {isExpanded ? (
                              <ChevronUp size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                          </button>

                          <span
                            className="w-4 h-4 rounded-md border border-[var(--color-border)] flex-shrink-0"
                            style={{ backgroundColor: record.color }}
                          />

                          {isEditing ? (
                            <input
                              type="text"
                              value={editingColorForm.name}
                              onChange={(event) =>
                                setEditingColorForm((previousForm) => ({
                                  ...previousForm,
                                  name: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void handleCommitColorEdit(record);
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  setEditingColorId(null);
                                }
                              }}
                              className="sor-form-input-xs flex-1 min-w-0"
                              aria-label={`Rename ${record.name}`}
                              autoFocus
                            />
                          ) : (
                            <span className="text-sm font-medium text-[var(--color-text)] truncate flex-1 min-w-0">
                              {record.name}
                            </span>
                          )}

                          {record.global && !isEditing && (
                            <span className="text-[10px] text-primary bg-primary/15 px-1.5 py-0.5 rounded-md flex-shrink-0 font-medium">
                              Global
                            </span>
                          )}
                          <span className="text-[10px] text-[var(--color-textMuted)] bg-[var(--color-border)]/70 px-1.5 py-0.5 rounded-md flex-shrink-0">
                            {connectionCountLabel(record.count)}
                          </span>

                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleCommitColorEdit(record)}
                                  className="sor-icon-btn-sm text-success"
                                  title="Save color tag"
                                  aria-label={`Save ${record.name}`}
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingColorId(null)}
                                  className="sor-icon-btn-sm"
                                  title="Cancel edit"
                                  aria-label={`Cancel edit ${record.name}`}
                                >
                                  <X size={13} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleStartColorAssignment(record)}
                                  className="sor-icon-btn-sm"
                                  title="Assign to connections"
                                  aria-label={`Assign ${record.name} to connections`}
                                >
                                  <Link2 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleStartColorEdit(record)}
                                  className="sor-icon-btn-sm"
                                  title="Edit"
                                  aria-label={`Edit ${record.name}`}
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteConfirm({
                                      kind: "color",
                                      id: record.id,
                                      name: record.name,
                                      count: record.count,
                                    })
                                  }
                                  className="sor-icon-btn-danger"
                                  title="Delete color tag"
                                  aria-label={`Delete ${record.name}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {!isExpanded && record.connections.length > 0 && (
                          <div className="px-3 pb-2 text-[11px] text-[var(--color-textMuted)] truncate">
                            {previewConnectionNames(record.connections)}
                          </div>
                        )}

                        {isExpanded && (
                          <div className="border-t border-[var(--color-border)] p-3 space-y-3">
                            {isEditing && (
                              <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/50 p-3">
                                <ColorControls
                                  color={editingColorForm.color}
                                  onChange={(color) =>
                                    setEditingColorForm((previousForm) => ({
                                      ...previousForm,
                                      color,
                                    }))
                                  }
                                  size="sm"
                                />
                                <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)] cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editingColorForm.global}
                                    onChange={(event) =>
                                      setEditingColorForm((previousForm) => ({
                                        ...previousForm,
                                        global: event.target.checked,
                                      }))
                                    }
                                    className="sor-form-checkbox"
                                  />
                                  Global
                                </label>
                              </div>
                            )}

                            <ConnectionMemberList
                              connections={visibleConnections}
                              emptyMessage="No assigned connections"
                              actionLabel="Clear color"
                              onAction={handleClearColorFromConnection}
                            />

                            {isAssigning && (
                              <AssignmentPanel
                                title="Assign to Connections"
                                selectedCount={assignmentTargetIds.size}
                                canSubmit={assignmentTargetIds.size > 0}
                                onSubmit={handleCommitAssignment}
                                onCancel={handleCancelAssignment}
                              >
                                <ConnectionTargetSelector
                                  connections={assignmentCandidates}
                                  selectedIds={assignmentTargetIds}
                                  onToggle={(connectionId) =>
                                    toggleSelectedId(
                                      setAssignmentTargetIds,
                                      connectionId,
                                    )
                                  }
                                  onReplace={(connectionIds) =>
                                    mergeSelectedIds(
                                      setAssignmentTargetIds,
                                      connectionIds,
                                    )
                                  }
                                  onClear={() => setAssignmentTargetIds(new Set())}
                                  quickTargets={colorQuickTargets}
                                  emptyMessage="Every target already uses this color"
                                />
                              </AssignmentPanel>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="pt-3 border-t border-[var(--color-border)] text-xs text-[var(--color-textMuted)]">
            {stats.totalTextTags} text, {stats.totalColorTags} color, {" "}
            {stats.colorTaggedConnectionCount} color-tagged
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        title={
          deleteConfirm?.kind === "color"
            ? "Delete color tag?"
            : "Delete text tag?"
        }
        variant="danger"
        confirmText="Delete"
        cancelText="Keep"
        message={
          deleteConfirm?.kind === "text"
            ? `Remove "${deleteConfirm.name}" from ${connectionCountLabel(
                deleteConfirm.count,
              )}?`
            : deleteConfirm?.kind === "color"
              ? `Delete "${deleteConfirm.name}"? ${connectionCountLabel(
                  deleteConfirm.count,
                )} will have this color tag cleared.`
              : ""
        }
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
};

const StatPill: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-border)]/30 px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">
      {label}
    </div>
    <div className="text-sm font-semibold text-[var(--color-text)]">{value}</div>
  </div>
);

const ConnectionTargetSelector: React.FC<{
  connections: Connection[];
  selectedIds: Set<string>;
  onToggle: (connectionId: string) => void;
  onReplace: (connectionIds: string[]) => void;
  onClear: () => void;
  quickTargets: QuickTarget[];
  emptyMessage: string;
}> = ({
  connections,
  selectedIds,
  onToggle,
  onReplace,
  onClear,
  quickTargets,
  emptyMessage,
}) => {
  const candidateIds = useMemo(
    () => new Set(connections.map((connection) => connection.id)),
    [connections],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="inline-flex items-center gap-1 text-[var(--color-textMuted)]">
          <Users size={12} />
          Targets
        </span>
        {quickTargets.map((quickTarget) => {
          const usableIds = quickTarget.connectionIds.filter((connectionId) =>
            candidateIds.has(connectionId),
          );
          return (
            <button
              key={quickTarget.id}
              type="button"
              onClick={() => onReplace(usableIds)}
              disabled={usableIds.length === 0}
              className="px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {quickTarget.label} ({usableIds.length})
            </button>
          );
        })}
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-[var(--color-textMuted)] hover:text-[var(--color-text)] underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>

      {connections.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-xs text-[var(--color-textMuted)]">
          {emptyMessage}
        </div>
      ) : (
        <div className="max-h-44 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/50 divide-y divide-[var(--color-border)]">
          {connections.map((connection) => {
            const checked = selectedIds.has(connection.id);
            return (
              <label
                key={connection.id}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--color-border)]/40"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(connection.id)}
                  className="sor-form-checkbox flex-shrink-0"
                  aria-label={`Select ${connection.name}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-[var(--color-text)] truncate">
                    {connection.name}
                  </span>
                  <span className="block text-[10px] text-[var(--color-textMuted)] truncate">
                    {connectionSubtitle(connection)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

const AssignmentPanel: React.FC<{
  title: string;
  selectedCount: number;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}> = ({ title, selectedCount, canSubmit, onSubmit, onCancel, children }) => (
  <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h5 className="text-xs font-medium text-[var(--color-text)] flex items-center gap-1.5">
        <Link2 size={13} className="text-primary" />
        {title}
      </h5>
      <span className="text-[10px] text-[var(--color-textMuted)]">
        {selectedCount} selected
      </span>
    </div>
    {children}
    <div className="flex items-center justify-end gap-2">
      <button type="button" onClick={onCancel} className="sor-btn-secondary-sm">
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="sor-btn-primary-sm"
      >
        <Check size={14} />
        <span>Assign</span>
      </button>
    </div>
  </div>
);

const ConnectionMemberList: React.FC<{
  connections: Connection[];
  emptyMessage: string;
  actionLabel: string;
  onAction: (connection: Connection) => void;
}> = ({ connections, emptyMessage, actionLabel, onAction }) => {
  if (connections.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-xs text-[var(--color-textMuted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {connections.map((connection) => (
        <div
          key={connection.id}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--color-border)]/40"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[var(--color-text)] truncate">
              {connection.name}
            </span>
            <span className="block text-[10px] text-[var(--color-textMuted)] truncate">
              {connectionSubtitle(connection)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onAction(connection)}
            className="sor-icon-btn-sm flex-shrink-0"
            title={actionLabel}
            aria-label={`${actionLabel} from ${connection.name}`}
          >
            <Unlink size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};

const ColorControls: React.FC<{
  color: string;
  onChange: (color: string) => void;
  size?: "sm" | "md";
}> = ({ color, onChange, size = "md" }) => (
  <div className="flex items-center gap-3 flex-wrap">
    <span
      className={`rounded-md border border-[var(--color-border)] flex-shrink-0 ${
        size === "sm" ? "w-5 h-5" : "w-7 h-7"
      }`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
    <div className="flex gap-1.5 flex-wrap">
      {PREDEFINED_COLORS.map((colorOption) => {
        const selected = color.toLocaleLowerCase() === colorOption.toLocaleLowerCase();
        return (
          <button
            key={colorOption}
            type="button"
            onClick={() => onChange(colorOption)}
            className={`rounded-full border-2 transition-transform hover:scale-110 ${
              selected ? "border-white scale-110" : "border-transparent"
            } ${size === "sm" ? "w-4 h-4" : "w-5 h-5"}`}
            style={{ backgroundColor: colorOption }}
            title={colorOption}
            aria-label={`Use color ${colorOption}`}
            aria-pressed={selected}
          />
        );
      })}
    </div>
    <CustomColorInput color={color} onChange={onChange} />
  </div>
);

const CustomColorInput: React.FC<{
  color: string;
  onChange: (color: string) => void;
}> = ({ color, onChange }) => {
  const [draftColor, setDraftColor] = useState(color);

  useEffect(() => {
    setDraftColor(color);
  }, [color]);

  const commitDraftColor = useCallback(() => {
    const normalizedColor = normalizeHex(draftColor);
    if (normalizedColor) onChange(normalizedColor);
    else setDraftColor(color);
  }, [color, draftColor, onChange]);

  return (
    <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-textMuted)] cursor-pointer">
      <span>Custom</span>
      <span
        className="relative inline-block w-5 h-5 rounded-full border-2 border-white/20 overflow-hidden"
        style={{ backgroundColor: color }}
      >
        <input
          type="color"
          value={HEX_PATTERN.test(color) ? color : DEFAULT_COLOR}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Pick custom color"
        />
      </span>
      <input
        type="text"
        value={draftColor}
        onChange={(event) => setDraftColor(event.target.value)}
        onBlur={commitDraftColor}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraftColor();
          }
        }}
        spellCheck={false}
        className="w-20 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-borderActive)]"
        placeholder="#3b82f6"
        aria-label="Custom hex color"
      />
    </label>
  );
};

export default TagManagerDialog;
