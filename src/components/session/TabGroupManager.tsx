import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Layers,
  Search,
  Plus,
  Pencil,
  Palette,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Trash2,
  FolderMinus,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Copy,
} from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "../ui/overlays/Modal";
import { EmptyState } from "../ui/display";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import type { ConnectionSession, TabGroup } from "../../types/connection/connection";

const GROUP_COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Yellow", value: "#eab308" },
  { name: "Green", value: "#22c55e" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
];

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

const normalizeHex = (raw: string): string | null => {
  const trimmed = raw.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (HEX_PATTERN.test(withHash)) return withHash.toLowerCase();
  // accept short form #abc
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const [, r, g, b] = withHash;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
};

const CustomColorPicker: React.FC<{
  value: string;
  onChange: (color: string) => void;
  size?: "sm" | "md";
}> = ({ value, onChange, size = "md" }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = useCallback(
    (raw: string) => {
      const next = normalizeHex(raw);
      if (next) onChange(next);
    },
    [onChange],
  );
  const swatchSize = size === "sm" ? "w-4 h-4" : "w-5 h-5";
  return (
    <label
      className="flex items-center gap-1.5 text-[10px] text-[var(--color-textMuted)] cursor-pointer"
      title="Custom color"
    >
      <span>Custom:</span>
      <span
        className={`relative inline-block ${swatchSize} rounded-full border-2 border-white/20 overflow-hidden`}
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          value={HEX_PATTERN.test(value) ? value : "#888888"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Pick custom color"
        />
      </span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
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

interface TabGroupManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TabGroupManager: React.FC<TabGroupManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const sessions = state.sessions.filter((s) => !s.layout?.isDetached);
  const tabGroups = state.tabGroups;

  const [searchFilter, setSearchFilter] = useState("");
  const [populationFilter, setPopulationFilter] = useState<"all" | "withTabs" | "empty">("all");
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  // Inline rename state
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Inline color picker state
  const [colorPickerGroupId, setColorPickerGroupId] = useState<string | null>(null);

  // New group creation
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[5].value);
  const newGroupInputRef = useRef<HTMLInputElement>(null);

  // Drag reorder state
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // Animation state — IDs currently fading out before the real dispatch fires.
  const [leavingGroupIds, setLeavingGroupIds] = useState<Set<string>>(new Set());

  const animEnabled =
    settings.animationsEnabled && settings.enableTabGroupAnimations;
  const animDurationMs = settings.animationDuration || 200;

  useEffect(() => {
    if (renamingGroupId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingGroupId]);

  useEffect(() => {
    if (showCreateForm && newGroupInputRef.current) {
      newGroupInputRef.current.focus();
    }
  }, [showCreateForm]);

  // ── Derived data ──────────────────────────────────────────────

  const groupsWithSessions = useMemo(() => {
    return tabGroups.map((group) => ({
      group,
      sessions: sessions.filter((s) => s.tabGroupId === group.id),
    }));
  }, [tabGroups, sessions]);

  const filteredGroups = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    return groupsWithSessions.filter((g) => {
      if (q && !g.group.name.toLowerCase().includes(q)) return false;
      if (populationFilter === "withTabs" && g.sessions.length === 0) return false;
      if (populationFilter === "empty" && g.sessions.length > 0) return false;
      if (colorFilter && g.group.color.toLowerCase() !== colorFilter.toLowerCase()) return false;
      return true;
    });
  }, [groupsWithSessions, searchFilter, populationFilter, colorFilter]);

  const distinctColors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const { group } of groupsWithSessions) {
      const key = group.color.toLowerCase();
      if (!seen.has(key)) seen.set(key, group.color);
    }
    return Array.from(seen.values());
  }, [groupsWithSessions]);

  const stats = useMemo(() => {
    const groupCount = tabGroups.length;
    const groupedTabCount = sessions.filter((s) => s.tabGroupId).length;
    const ungroupedTabCount = sessions.filter((s) => !s.tabGroupId).length;
    return { groupCount, groupedTabCount, ungroupedTabCount };
  }, [tabGroups, sessions]);

  // ── Actions ───────────────────────────────────────────────────

  const toggleExpand = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleStartRename = useCallback((groupId: string) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (!group) return;
    setRenameValue(group.name);
    setRenamingGroupId(groupId);
  }, [tabGroups]);

  const handleCommitRename = useCallback(() => {
    if (renamingGroupId && renameValue.trim()) {
      const group = tabGroups.find((g) => g.id === renamingGroupId);
      if (group) {
        dispatch({
          type: "UPDATE_TAB_GROUP",
          payload: { ...group, name: renameValue.trim() },
        });
      }
    }
    setRenamingGroupId(null);
    setRenameValue("");
  }, [renamingGroupId, renameValue, tabGroups, dispatch]);

  const handleCancelRename = useCallback(() => {
    setRenamingGroupId(null);
    setRenameValue("");
  }, []);

  const handleChangeColor = useCallback(
    (groupId: string, color: string) => {
      const group = tabGroups.find((g) => g.id === groupId);
      if (group) {
        dispatch({
          type: "UPDATE_TAB_GROUP",
          payload: { ...group, color },
        });
      }
    },
    [tabGroups, dispatch]
  );

  const handleToggleCollapse = useCallback(
    (groupId: string) => {
      const group = tabGroups.find((g) => g.id === groupId);
      if (group) {
        dispatch({
          type: "UPDATE_TAB_GROUP",
          payload: { ...group, collapsed: !group.collapsed },
        });
      }
    },
    [tabGroups, dispatch]
  );

  const handleSelectAll = useCallback(
    (groupId: string) => {
      const groupSessions = sessions.filter((s) => s.tabGroupId === groupId);
      if (groupSessions.length > 0) {
        // Select the first session in the group (dispatches focus)
        window.dispatchEvent(
          new CustomEvent("select-session", {
            detail: { sessionId: groupSessions[0].id },
          })
        );
      }
    },
    [sessions]
  );

  const handleMoveGroup = useCallback(
    (groupId: string, direction: "up" | "down") => {
      const idx = tabGroups.findIndex((g) => g.id === groupId);
      if (idx === -1) return;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= tabGroups.length) return;

      // Remove the group, then re-add it at the new position.
      // We achieve this by removing and re-adding in sequence.
      const moving = tabGroups[idx];
      const neighbor = tabGroups[targetIdx];

      // Remove both, add back in swapped order
      dispatch({ type: "REMOVE_TAB_GROUP", payload: moving.id });
      dispatch({ type: "REMOVE_TAB_GROUP", payload: neighbor.id });

      if (direction === "up") {
        dispatch({ type: "ADD_TAB_GROUP", payload: moving });
        dispatch({ type: "ADD_TAB_GROUP", payload: neighbor });
      } else {
        dispatch({ type: "ADD_TAB_GROUP", payload: neighbor });
        dispatch({ type: "ADD_TAB_GROUP", payload: moving });
      }
    },
    [tabGroups, dispatch]
  );

  const handleUngroupAll = useCallback(
    (groupId: string) => {
      // Remove tabGroupId from all sessions in this group
      const groupSessions = sessions.filter((s) => s.tabGroupId === groupId);
      for (const session of groupSessions) {
        dispatch({
          type: "UPDATE_SESSION",
          payload: { ...session, tabGroupId: undefined },
        });
      }
      dispatch({ type: "REMOVE_TAB_GROUP", payload: groupId });
    },
    [sessions, dispatch]
  );

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      const group = tabGroups.find((g) => g.id === groupId);
      const groupSessions = sessions.filter((s) => s.tabGroupId === groupId);
      if (settings.confirmDeleteTabGroup && group) {
        const tabPart =
          groupSessions.length === 0
            ? "this empty group"
            : `"${group.name}" and close ${groupSessions.length} ${
                groupSessions.length === 1 ? "tab" : "tabs"
              }`;
        if (!confirm(`Delete ${tabPart}? This cannot be undone.`)) return;
      }
      const finalize = () => {
        for (const session of groupSessions) {
          dispatch({ type: "REMOVE_SESSION", payload: session.id });
        }
        dispatch({ type: "REMOVE_TAB_GROUP", payload: groupId });
        setLeavingGroupIds((prev) => {
          if (!prev.has(groupId)) return prev;
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
      };
      if (!animEnabled) {
        finalize();
        return;
      }
      setLeavingGroupIds((prev) => new Set(prev).add(groupId));
      window.setTimeout(finalize, animDurationMs);
    },
    [
      sessions,
      tabGroups,
      dispatch,
      settings.confirmDeleteTabGroup,
      animEnabled,
      animDurationMs,
    ],
  );

  const handleCloneGroup = useCallback(
    (groupId: string) => {
      const source = tabGroups.find((g) => g.id === groupId);
      if (!source) return;
      // Pick a unique name with "(copy)" / "(copy N)" suffix.
      const existingNames = new Set(tabGroups.map((g) => g.name));
      const base = source.name.replace(/\s*\(copy(?: \d+)?\)$/i, "");
      let candidate = `${base} (copy)`;
      let n = 2;
      while (existingNames.has(candidate)) {
        candidate = `${base} (copy ${n++})`;
      }
      const clone: TabGroup = {
        id: crypto.randomUUID(),
        name: candidate,
        color: source.color,
        collapsed: source.collapsed,
      };
      dispatch({ type: "ADD_TAB_GROUP", payload: clone });
    },
    [tabGroups, dispatch],
  );

  const handleCreateGroup = useCallback(() => {
    const name = newGroupName.trim();
    if (!name) return;
    const newGroup: TabGroup = {
      id: crypto.randomUUID(),
      name,
      color: newGroupColor,
      collapsed: false,
    };
    dispatch({ type: "ADD_TAB_GROUP", payload: newGroup });
    setNewGroupName("");
    setNewGroupColor(GROUP_COLORS[5].value);
    setShowCreateForm(false);
  }, [newGroupName, newGroupColor, dispatch]);

  // ── Drag and drop for group reorder ───────────────────────────

  const handleGroupDragStart = useCallback(
    (e: React.DragEvent, groupId: string) => {
      setDraggedGroupId(groupId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", groupId);
    },
    []
  );

  const handleGroupDragOver = useCallback(
    (e: React.DragEvent, groupId: string) => {
      if (!draggedGroupId || draggedGroupId === groupId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverGroupId(groupId);
    },
    [draggedGroupId]
  );

  const handleGroupDrop = useCallback(
    (e: React.DragEvent, dropGroupId: string) => {
      e.preventDefault();
      if (!draggedGroupId || draggedGroupId === dropGroupId) {
        setDraggedGroupId(null);
        setDragOverGroupId(null);
        return;
      }

      const fromIdx = tabGroups.findIndex((g) => g.id === draggedGroupId);
      const toIdx = tabGroups.findIndex((g) => g.id === dropGroupId);
      if (fromIdx === -1 || toIdx === -1) return;

      // Rebuild groups array with the dragged group moved
      const newGroups = [...tabGroups];
      const [moved] = newGroups.splice(fromIdx, 1);
      newGroups.splice(toIdx, 0, moved);

      // Remove all groups and re-add in new order
      for (const g of tabGroups) {
        dispatch({ type: "REMOVE_TAB_GROUP", payload: g.id });
      }
      for (const g of newGroups) {
        dispatch({ type: "ADD_TAB_GROUP", payload: g });
      }

      setDraggedGroupId(null);
      setDragOverGroupId(null);
    },
    [draggedGroupId, tabGroups, dispatch]
  );

  const handleGroupDragEnd = useCallback(() => {
    setDraggedGroupId(null);
    setDragOverGroupId(null);
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, groupId: string, index: number) => {
      if (e.key === "ArrowDown" && index < filteredGroups.length - 1) {
        e.preventDefault();
        const nextEl = document.querySelector(
          `[data-group-index="${index + 1}"]`
        ) as HTMLElement;
        nextEl?.focus();
      } else if (e.key === "ArrowUp" && index > 0) {
        e.preventDefault();
        const prevEl = document.querySelector(
          `[data-group-index="${index - 1}"]`
        ) as HTMLElement;
        prevEl?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        toggleExpand(groupId);
      }
    },
    [filteredGroups.length, toggleExpand]
  );

  if (!isOpen) return null;

  if (!isOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          {/* Heading + primary action */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                Tab Group Manager
              </h3>
              <div className="text-xs text-[var(--color-textSecondary)] mt-1 space-y-1">
                <p>
                  Bundle open session tabs into named, color-coded groups so
                  you can see what belongs together at a glance and act on
                  them as a unit.
                </p>
                <p className="text-[var(--color-textMuted)]">
                  Drag groups to reorder them, collapse a group to hide its
                  tabs in the tab bar, ungroup to detach the tabs without
                  closing them, or delete a group to close every tab inside.
                  Set a default tab group on a connection (in its editor) to
                  auto-route new sessions for that host into the right group.
                </p>
              </div>
            </div>
            {!showCreateForm && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="sor-btn-primary-sm flex-shrink-0"
              >
                <Plus size={14} />
                <span>New Group</span>
              </button>
            )}
          </div>

          {/* Search + filters */}
          <div className="space-y-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="sor-form-input-xs sor-form-input-xs-icon-left w-full"
                placeholder="Search groups..."
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              {(
                [
                  { key: "all", label: `All (${tabGroups.length})` },
                  { key: "withTabs", label: `With tabs (${groupsWithSessions.filter((g) => g.sessions.length > 0).length})` },
                  { key: "empty", label: `Empty (${groupsWithSessions.filter((g) => g.sessions.length === 0).length})` },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setPopulationFilter(opt.key)}
                  className={`px-2 py-0.5 rounded-full border transition-colors ${
                    populationFilter === opt.key
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "bg-[var(--color-border)]/40 border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              {distinctColors.length > 0 && (
                <>
                  <span className="mx-1 h-3 w-px bg-[var(--color-border)]" />
                  <span className="text-[var(--color-textMuted)]">Color:</span>
                  {distinctColors.map((c) => (
                    <button
                      key={c}
                      onClick={() =>
                        setColorFilter((prev) =>
                          prev?.toLowerCase() === c.toLowerCase() ? null : c,
                        )
                      }
                      className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-110 ${
                        colorFilter?.toLowerCase() === c.toLowerCase()
                          ? "border-white scale-110"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                      title={`Filter by ${c}`}
                      aria-label={`Filter by color ${c}`}
                      aria-pressed={colorFilter?.toLowerCase() === c.toLowerCase()}
                    />
                  ))}
                </>
              )}
              {(searchFilter || populationFilter !== "all" || colorFilter) && (
                <button
                  onClick={() => {
                    setSearchFilter("");
                    setPopulationFilter("all");
                    setColorFilter(null);
                  }}
                  className="ml-auto text-[var(--color-textMuted)] hover:text-[var(--color-text)] underline underline-offset-2"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Inline create form */}
          {showCreateForm && (
            <div
              className={`rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3 ${
                animEnabled ? "animate-fade-in-down" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
                  <Plus size={14} className="text-primary" />
                  New Tab Group
                </h4>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewGroupName("");
                  }}
                  className="sor-icon-btn-sm"
                  title="Cancel"
                  aria-label="Cancel new group"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="new-group-name"
                  className="block text-[11px] font-medium text-[var(--color-textSecondary)]"
                >
                  Name
                </label>
                <input
                  ref={newGroupInputRef}
                  id="new-group-name"
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreateGroup();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setShowCreateForm(false);
                      setNewGroupName("");
                    }
                  }}
                  placeholder="e.g. Production servers"
                  className="sor-form-input-xs w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-medium text-[var(--color-textSecondary)]">
                  Color
                </label>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex gap-1.5">
                    {GROUP_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setNewGroupColor(c.value)}
                        className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                          newGroupColor === c.value
                            ? "border-white scale-110 shadow"
                            : "border-transparent"
                        }`}
                        style={{ backgroundColor: c.value }}
                        title={c.name}
                        aria-label={`Use ${c.name}`}
                      />
                    ))}
                  </div>
                  <span className="text-[var(--color-textMuted)] text-[11px]">
                    or
                  </span>
                  <CustomColorPicker
                    value={newGroupColor}
                    onChange={setNewGroupColor}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewGroupName("");
                  }}
                  className="px-3 py-1.5 text-xs rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="sor-btn-primary-sm"
                >
                  <Check size={14} />
                  <span>Create Group</span>
                </button>
              </div>
            </div>
          )}

          {/* Content */}
          <div>
            {filteredGroups.length === 0 && tabGroups.length === 0 ? (
              <EmptyState
                icon={Layers}
                iconSize={48}
                message="No tab groups yet"
                hint="Right-click a tab and select 'New Group from Tab' to get started."
                className="py-12"
              />
            ) : filteredGroups.length === 0 ? (
              <div className={animEnabled ? "animate-fade-in" : ""}>
                <EmptyState
                  icon={Search}
                  iconSize={40}
                  message="No groups match your search"
                  hint="Try a different search term"
                  className="py-8"
                />
              </div>
            ) : (
              <div className="space-y-2">
                {filteredGroups.map(({ group, sessions: groupSessions }, index) => {
                  const isExpanded = expandedGroupIds.has(group.id);
                  const isFirst = index === 0;
                  const isLast = index === filteredGroups.length - 1;
                  const isDragOver = dragOverGroupId === group.id;
                  const isDragging = draggedGroupId === group.id;
                  const isLeaving = leavingGroupIds.has(group.id);

                  return (
                    <div
                      key={group.id}
                      data-group-index={index}
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => handleGroupDragStart(e, group.id)}
                      onDragOver={(e) => handleGroupDragOver(e, group.id)}
                      onDrop={(e) => handleGroupDrop(e, group.id)}
                      onDragEnd={handleGroupDragEnd}
                      onKeyDown={(e) => handleKeyDown(e, group.id, index)}
                      className={`rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-primary transition-smooth ${
                        isDragOver
                          ? "border-primary bg-primary/5"
                          : "border-[var(--color-border)] bg-[var(--color-border)]/30"
                      } ${isDragging ? "opacity-50" : ""} ${
                        animEnabled && isLeaving ? "animate-fade-out" : ""
                      } ${animEnabled && !isLeaving ? "animate-fade-in-down" : ""}`}
                      style={
                        animEnabled && isLeaving
                          ? { pointerEvents: "none" }
                          : undefined
                      }
                    >
                      {/* Group header row */}
                      <div className="flex items-center gap-2 p-3">
                        {/* Drag handle */}
                        <GripVertical
                          size={14}
                          className="text-[var(--color-textMuted)] cursor-grab flex-shrink-0"
                        />

                        {/* Color swatch (click to toggle color picker) */}
                        <button
                          onClick={() =>
                            setColorPickerGroupId(
                              colorPickerGroupId === group.id ? null : group.id
                            )
                          }
                          className="w-5 h-5 rounded-full border-2 border-[var(--color-border)] flex-shrink-0 hover:scale-110 transition-transform"
                          style={{ backgroundColor: group.color }}
                          title="Change color"
                        />

                        {/* Group name (editable) */}
                        {renamingGroupId === group.id ? (
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleCommitRename();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                handleCancelRename();
                              }
                            }}
                            onBlur={handleCommitRename}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-medium bg-[var(--color-bg)] border border-[var(--color-borderActive)] rounded px-2 py-0.5 outline-none text-[var(--color-text)] flex-1 min-w-0"
                          />
                        ) : (
                          <span
                            className="text-sm font-medium text-[var(--color-text)] truncate flex-1 min-w-0 cursor-pointer"
                            onDoubleClick={() => handleStartRename(group.id)}
                            title="Double-click to rename"
                          >
                            {group.name}
                          </span>
                        )}

                        {/* Member count badge */}
                        <span className="text-xs text-[var(--color-textSecondary)] bg-[var(--color-border)] px-1.5 py-0.5 rounded flex-shrink-0">
                          {groupSessions.length}{" "}
                          {groupSessions.length === 1 ? "tab" : "tabs"}
                        </span>

                        {/* Collapsed indicator */}
                        {group.collapsed && (
                          <span className="text-[10px] text-[var(--color-textMuted)] bg-[var(--color-border)] px-1 py-0.5 rounded flex-shrink-0">
                            collapsed
                          </span>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => handleStartRename(group.id)}
                            className="sor-icon-btn-sm"
                            title="Rename"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() =>
                              setColorPickerGroupId(
                                colorPickerGroupId === group.id
                                  ? null
                                  : group.id
                              )
                            }
                            className="sor-icon-btn-sm"
                            title="Change color"
                          >
                            <Palette size={13} />
                          </button>
                          <button
                            onClick={() => handleToggleCollapse(group.id)}
                            className="sor-icon-btn-sm"
                            title={
                              group.collapsed
                                ? "Expand in tab bar"
                                : "Collapse in tab bar"
                            }
                          >
                            {group.collapsed ? (
                              <ChevronRight size={13} />
                            ) : (
                              <ChevronDown size={13} />
                            )}
                          </button>
                          <button
                            onClick={() => handleMoveGroup(group.id, "up")}
                            className={`sor-icon-btn-sm ${
                              isFirst
                                ? "opacity-30 pointer-events-none"
                                : ""
                            }`}
                            disabled={isFirst}
                            title="Move group up"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            onClick={() => handleMoveGroup(group.id, "down")}
                            className={`sor-icon-btn-sm ${
                              isLast
                                ? "opacity-30 pointer-events-none"
                                : ""
                            }`}
                            disabled={isLast}
                            title="Move group down"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            onClick={() => handleCloneGroup(group.id)}
                            className="sor-icon-btn-sm"
                            title="Clone group (name + color, no tabs)"
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            onClick={() => handleUngroupAll(group.id)}
                            className="sor-icon-btn-sm"
                            title="Ungroup all (keeps tabs)"
                          >
                            <FolderMinus size={13} />
                          </button>
                          <button
                            onClick={() => handleDeleteGroup(group.id)}
                            className="sor-icon-btn-danger"
                            title={
                              groupSessions.length === 0
                                ? "Delete group"
                                : `Delete group (closes ${groupSessions.length} ${
                                    groupSessions.length === 1 ? "tab" : "tabs"
                                  })`
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        {/* Expand/collapse member list toggle */}
                        <button
                          onClick={() => toggleExpand(group.id)}
                          className="sor-icon-btn-sm flex-shrink-0"
                          title={
                            isExpanded ? "Hide member list" : "Show member list"
                          }
                        >
                          {isExpanded ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </button>
                      </div>

                      {/* Inline color picker */}
                      {colorPickerGroupId === group.id && (
                        <div
                          className={`px-3 pb-2 flex items-center gap-3 flex-wrap ${
                            animEnabled ? "animate-fade-in" : ""
                          }`}
                        >
                          <span className="text-[10px] text-[var(--color-textMuted)]">
                            Color:
                          </span>
                          <div className="flex gap-1.5 flex-wrap">
                            {GROUP_COLORS.map((c) => (
                              <button
                                key={c.value}
                                onClick={() => {
                                  handleChangeColor(group.id, c.value);
                                }}
                                className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                                  group.color === c.value
                                    ? "border-white"
                                    : "border-transparent"
                                }`}
                                style={{ backgroundColor: c.value }}
                                title={c.name}
                              />
                            ))}
                          </div>
                          <CustomColorPicker
                            value={group.color}
                            onChange={(v) => handleChangeColor(group.id, v)}
                          />
                        </div>
                      )}

                      {/* Expanded member list */}
                      {isExpanded && (
                        <div
                          className={`border-t border-[var(--color-border)] px-3 py-2 ${
                            animEnabled ? "animate-fade-in" : ""
                          }`}
                        >
                          {groupSessions.length === 0 ? (
                            <div className="text-xs text-[var(--color-textMuted)] py-1 text-center">
                              No tabs in this group
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {groupSessions.map((session) => (
                                <div
                                  key={session.id}
                                  className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-[var(--color-border)]/50"
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: group.color }}
                                  />
                                  <span className="truncate text-[var(--color-text)] flex-1 min-w-0">
                                    {session.name}
                                  </span>
                                  <span className="text-[var(--color-textMuted)] flex-shrink-0">
                                    {session.protocol}
                                  </span>
                                  <span
                                    className={`flex-shrink-0 ${
                                      session.status === "connected"
                                        ? "text-success"
                                        : session.status === "connecting"
                                        ? "text-warning"
                                        : "text-[var(--color-textMuted)]"
                                    }`}
                                  >
                                    {session.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Compact member list (when collapsed) */}
                      {!isExpanded && groupSessions.length > 0 && (
                        <div className="px-3 pb-2">
                          <div className="text-[11px] text-[var(--color-textMuted)] truncate">
                            {groupSessions
                              .map((s) => s.name)
                              .join(", ")}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer (stats only) */}
          <div className="pt-3 border-t border-[var(--color-border)] text-xs text-[var(--color-textMuted)]">
            {stats.groupCount} {stats.groupCount === 1 ? "group" : "groups"},{" "}
            {stats.groupedTabCount} grouped{" "}
            {stats.groupedTabCount === 1 ? "tab" : "tabs"},{" "}
            {stats.ungroupedTabCount} ungrouped
          </div>
        </div>
      </div>
    </div>
  );
};

export default TabGroupManager;
